from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_
import os
from pathlib import Path
import json
import asyncio
import subprocess
import datetime
from backend.app.auth import get_current_user, decode_access_token
from backend.app.database import get_db, SessionLocal
from backend.app.models import User, AgentPersona, LocalRepository, ChatSession
from backend.app.services.git_service import git_service
from backend.app.services.port_service import port_manager
from backend.app.services.terminal_service import terminal_manager, pty_manager
import uuid

router = APIRouter(prefix="/api/agents", tags=["agents"])

class AgentCreatePayload(BaseModel):
    id: str | None = None
    name: str
    role_description: str
    icon: str = "bot"
    system_instructions: str

class InstructionUpdatePayload(BaseModel):
    system_instructions: str

class RepoCreatePayload(BaseModel):
    name: str
    remote_url: str
    clone_type: str = "full"
    default_branch: str = ""

class RepoBranchPayload(BaseModel):
    branch: str


@router.get("")
def list_agent_personas(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    personas = db.query(AgentPersona).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "role_description": p.role_description,
            "icon": p.icon,
            "system_instructions": p.system_instructions,
            "is_default": p.is_default,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None
        }
        for p in personas
    ]

@router.post("")
def create_agent_persona(
    payload: AgentCreatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    agent_id = payload.id or payload.name.lower().replace(" ", "-").replace("_", "-")
    existing = db.query(AgentPersona).filter(AgentPersona.id == agent_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="An agent with this identifier already exists")

    persona = AgentPersona(
        id=agent_id,
        name=payload.name,
        role_description=payload.role_description,
        icon=payload.icon,
        system_instructions=payload.system_instructions,
        is_default=False
    )
    db.add(persona)
    db.commit()
    return {"message": "Agent persona created successfully", "id": persona.id}

@router.put("/{agent_id}/instructions")
def update_instructions(
    agent_id: str,
    payload: InstructionUpdatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    persona = db.query(AgentPersona).filter(AgentPersona.id == agent_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Agent persona not found")

    persona.system_instructions = payload.system_instructions
    db.commit()
    return {"id": persona.id, "system_instructions": persona.system_instructions}

@router.delete("/{agent_id}")
def delete_agent_persona(
    agent_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    persona = db.query(AgentPersona).filter(AgentPersona.id == agent_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Agent persona not found")
    if persona.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete default system personas")

    db.delete(persona)
    db.commit()
    return {"message": "Agent persona removed"}

@router.get("/repositories")
def list_repositories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    repos = db.query(LocalRepository).all()
    results = []
    for r in repos:
        is_cloned = git_service.is_repo_cloned(r.local_path)
        results.append({
            "id": r.id,
            "name": r.name,
            "remote_url": r.remote_url,
            "local_path": r.local_path,
            "clone_type": r.clone_type,
            "default_branch": r.default_branch,
            "is_cloned": is_cloned,
            "last_synced_at": r.last_synced_at.isoformat() if r.last_synced_at else None
        })
    return results

@router.post("/repositories")
def register_repository(
    payload: RepoCreatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    safe_name = git_service.sanitize_repo_name(payload.name)
    existing = db.query(LocalRepository).filter(LocalRepository.name == safe_name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Repository '{safe_name}' is already registered in local storage catalog.")

    try:
        clone_result = git_service.clone_repository(
            name=safe_name,
            remote_url=payload.remote_url,
            clone_type=payload.clone_type,
            default_branch=payload.default_branch
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    repo = LocalRepository(
        name=safe_name,
        remote_url=payload.remote_url,
        local_path=clone_result["local_path"],
        clone_type=payload.clone_type,
        default_branch=clone_result.get("branch", payload.default_branch),
        last_synced_at=datetime.datetime.utcnow()
    )
    db.add(repo)
    db.commit()
    db.refresh(repo)

    return {
        "message": f"Successfully cloned repository '{safe_name}' into persistent local storage.",
        "id": repo.id,
        "local_path": repo.local_path,
        "head_sha": clone_result.get("head_sha", ""),
        "commit_count": clone_result.get("commit_count", 0),
        "ingested_commits": clone_result.get("ingested_commits", 0)
    }

class SyncRepositoryRequest(BaseModel):
    branch: str | None = None

class CreateWorktreeRequest(BaseModel):
    branch: str
    base_branch: str = "main"

@router.post("/repositories/{repo_id}/sync")
def sync_repository(
    repo_id: int,
    req: SyncRepositoryRequest | None = None,
    branch: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    target_branch = (req.branch if req else None) or branch or repo.default_branch

    try:
        sync_result = git_service.sync_repository(
            local_path=repo.local_path,
            default_branch=repo.default_branch,
            remote_url=repo.remote_url,
            target_branch=target_branch,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    repo.local_path = sync_result.get("local_path", repo.local_path)
    repo.default_branch = sync_result.get("branch", repo.default_branch)
    repo.last_synced_at = datetime.datetime.utcnow()
    db.commit()

    return {
        "message": f"Repository '{repo.name}' synced successfully on branch '{repo.default_branch}'.",
        "branch": repo.default_branch,
        "last_synced_at": repo.last_synced_at.isoformat(),
        "head_sha": sync_result.get("head_sha", ""),
        "commit_count": sync_result.get("commit_count", 0),
        "ingested_commits": sync_result.get("ingested_commits", 0)
    }

@router.get("/repositories/{repo_id}/worktrees")
def list_repository_worktrees(
    repo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    wts = git_service.list_worktrees(repo.local_path)
    for wt in wts:
        port = port_manager.get_or_allocate_port(
            db=db,
            repo_id=repo.id,
            worktree_path=wt.get("path"),
            repo_name=repo.name,
            branch=wt.get("branch"),
        )
        wt["assigned_port"] = port
        wt["preview_url"] = port_manager.get_preview_url(port)
    return wts

@router.get("/repositories/{repo_id}/port")
def get_worktree_port(
    repo_id: int,
    worktree_path: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    port = port_manager.get_or_allocate_port(
        db=db,
        repo_id=repo.id,
        worktree_path=worktree_path,
        repo_name=repo.name,
    )
    return {
        "assigned_port": port,
        "port_range": {"start": port_manager.port_start, "end": port_manager.port_end},
        "public_host": port_manager.public_host,
        "preview_url": port_manager.get_preview_url(port),
        "env": {
            "PORT": str(port),
            "APP_PORT": str(port),
            "VITE_PORT": str(port),
            "HOST": "0.0.0.0",
        }
    }

@router.post("/repositories/{repo_id}/worktrees")
def create_repository_worktree(
    repo_id: int,
    req: CreateWorktreeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    try:
        wt = git_service.create_worktree(
            local_path_or_repo=repo.local_path,
            new_branch=req.branch,
            base_branch=req.base_branch or repo.default_branch,
        )
        port = port_manager.get_or_allocate_port(
            db=db,
            repo_id=repo.id,
            worktree_path=wt.get("worktree_path"),
            repo_name=repo.name,
            branch=wt.get("branch"),
        )
        wt["assigned_port"] = port
        wt["preview_url"] = port_manager.get_preview_url(port)
        return {"message": "Worktree created successfully", "worktree": wt}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class RemoveWorktreeRequest(BaseModel):
    worktree_path: str
    archive_sessions: bool | None = True

@router.delete("/repositories/{repo_id}/worktrees")
def remove_repository_worktree(
    repo_id: int,
    req: RemoveWorktreeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    
    # Safety: Disallow deleting main repository root through worktree endpoint
    main_repo_path = Path(repo.local_path).resolve()
    target_wt_path = Path(req.worktree_path).resolve()
    if target_wt_path == main_repo_path or str(target_wt_path) == str(main_repo_path):
        raise HTTPException(
            status_code=400,
            detail="The main repository cannot be deleted from the code editor. To delete the repository, please use the Repository Manager."
        )

    # Find and handle associated chat sessions
    norm_wt_path = str(target_wt_path)
    sessions = db.query(ChatSession).filter(
        ChatSession.repo_id == repo.id,
        or_(
            ChatSession.worktree_path == req.worktree_path,
            ChatSession.worktree_path == norm_wt_path
        )
    ).all()

    archived_count = 0
    deleted_count = 0
    should_archive = req.archive_sessions if req.archive_sessions is not None else True
    for s in sessions:
        if should_archive:
            s.is_archived = True
            s.updated_at = datetime.datetime.utcnow()
            archived_count += 1
        else:
            db.delete(s)
            deleted_count += 1
    db.commit()

    port_manager.release_port(db, repo.id, req.worktree_path)
    success = git_service.remove_worktree(repo.local_path, req.worktree_path)
    return {
        "success": success,
        "message": f"Worktree removed, assigned port released ({archived_count} session(s) archived)" if should_archive else "Worktree removed and sessions permanently deleted",
        "archived_sessions_count": archived_count,
        "deleted_sessions_count": deleted_count
    }

@router.get("/repositories/{repo_id}/tree")
def get_repository_tree(
    repo_id: int,
    worktree_path: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    try:
        return git_service.get_file_tree(repo.local_path, worktree_path=worktree_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/repositories/{repo_id}/content")
def get_file_content(
    repo_id: int,
    path: str,
    worktree_path: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    try:
        return git_service.get_file_content(repo.local_path, file_path=path, worktree_path=worktree_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class SaveFileRequest(BaseModel):
    path: str
    content: str
    worktree_path: str | None = None

@router.put("/repositories/{repo_id}/content")
def save_file_content(
    repo_id: int,
    req: SaveFileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    try:
        return git_service.save_file_content(
            repo.local_path,
            file_path=req.path,
            content=req.content,
            worktree_path=req.worktree_path,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/repositories/{repo_id}/diff")
def get_repository_diff(
    repo_id: int,
    worktree_path: str | None = None,
    base_branch: str = "main",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    try:
        return git_service.get_diff_summary(
            repo.local_path,
            worktree_path=worktree_path,
            base_branch=base_branch or repo.default_branch or "main",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class TerminalRunRequest(BaseModel):
    command: str
    worktree_path: str | None = None
    timeout: int = 60

class TerminalStreamRequest(BaseModel):
    command: str
    worktree_path: str | None = None
    session_id: str | None = None
    timeout: int = 600

@router.post("/repositories/{repo_id}/terminal/stream")
async def stream_terminal_command(
    repo_id: int,
    req: TerminalStreamRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    try:
        target_dir = git_service._resolve_working_dir(repo.local_path, req.worktree_path)
        assigned_port = port_manager.get_or_allocate_port(
            db=db,
            repo_id=repo.id,
            worktree_path=req.worktree_path,
            repo_name=repo.name,
        )

        session_id = req.session_id or str(uuid.uuid4())
        generator = terminal_manager.stream_command(
            command=req.command,
            cwd=target_dir,
            assigned_port=assigned_port,
            session_id=session_id,
            timeout=min(1800, max(5, req.timeout)),
        )
        return StreamingResponse(generator, media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/terminal/{session_id}/cancel")
async def cancel_terminal_process(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    killed = await terminal_manager.kill(session_id)
    return {"success": True, "killed": killed, "session_id": session_id}

@router.post("/repositories/{repo_id}/terminal")
def run_terminal_command(
    repo_id: int,
    req: TerminalRunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    try:
        assigned_port = port_manager.get_or_allocate_port(
            db=db,
            repo_id=repo.id,
            worktree_path=req.worktree_path,
            repo_name=repo.name,
        )
        return git_service.execute_terminal_command(
            repo.local_path,
            command=req.command,
            worktree_path=req.worktree_path,
            timeout=min(180, max(5, req.timeout)),
            assigned_port=assigned_port,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.websocket("/repositories/{repo_id}/terminal/pty")
async def websocket_terminal_pty(
    websocket: WebSocket,
    repo_id: int,
    worktree_path: str | None = None,
    token: str | None = None,
    cols: int = 80,
    rows: int = 24,
    db: Session = Depends(get_db),
):
    """
    Real-time interactive pseudoterminal (PTY) WebSocket endpoint.
    Streams raw ANSI characters bidirectionally between xterm.js in the browser
    and a real Linux PTY bash process running in the worktree workspace.
    """
    user = None
    if token:
        payload = decode_access_token(token)
        if payload and payload.get("sub"):
            user = db.query(User).filter(User.id == int(payload["sub"])).first()

    if not user:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        await websocket.close(code=4004, reason="Repository not found")
        return

    # Determine execution root directory safely with boundary enforcement
    try:
        cwd = git_service._resolve_working_dir(repo.local_path, worktree_path)
    except Exception as e:
        await websocket.close(code=4003, reason=f"Access denied: {e}")
        return

    assigned_port = port_manager.get_or_allocate_port(
        db=db,
        repo_id=repo.id,
        worktree_path=str(cwd),
        repo_name=repo.name,
    )

    await websocket.accept()

    session_key = f"pty_{user.id}_{repo.id}_{cwd}"
    session = pty_manager.get_or_create(session_key, cwd=cwd, assigned_port=assigned_port)
    if not session.proc or session.proc.returncode is not None:
        session.clear_scrollback()
        await session.start(initial_cols=cols, initial_rows=rows)
    else:
        session.resize(cols, rows)

    # Replay scrollback buffer on connect so page refresh preserves terminal state
    scrollback = session.get_scrollback()
    if scrollback:
        try:
            await websocket.send_text(scrollback)
        except Exception:
            pass

    # Subscribe to live PTY output
    queue: asyncio.Queue[str] = asyncio.Queue()
    session.subscribe(queue)

    async def ws_sender():
        try:
            while True:
                data = await queue.get()
                await websocket.send_text(data)
        except (asyncio.CancelledError, WebSocketDisconnect):
            pass
        except Exception:
            pass

    sender_task = asyncio.create_task(ws_sender())

    try:
        while True:
            msg = await websocket.receive_text()
            try:
                parsed = json.loads(msg)
                if isinstance(parsed, dict) and parsed.get("type") == "input":
                    session.write(parsed.get("data", ""))
                elif isinstance(parsed, dict) and parsed.get("type") == "resize":
                    c = int(parsed.get("cols", 80))
                    r = int(parsed.get("rows", 24))
                    session.resize(c, r)
                elif isinstance(parsed, dict) and parsed.get("type") == "clear":
                    session.clear_scrollback()
                elif isinstance(parsed, dict) and parsed.get("type") == "restart":
                    session.close()
                    await session.start(initial_cols=cols, initial_rows=rows)
                else:
                    session.write(msg)
            except json.JSONDecodeError:
                session.write(msg)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        session.unsubscribe(queue)
        sender_task.cancel()


class CommitRequest(BaseModel):
    message: str
    worktree_path: str | None = None

@router.post("/repositories/{repo_id}/commit")
def commit_worktree_changes(
    repo_id: int,
    req: CommitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    try:
        author_name = None
        author_email = None
        if current_user.settings:
            author_name = current_user.settings.git_name
            author_email = current_user.settings.git_email or current_user.email

        return git_service.commit_worktree_changes(
            repo.local_path,
            message=req.message,
            worktree_path=req.worktree_path,
            author_name=author_name,
            author_email=author_email,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/repositories/{repo_id}")
def delete_repository(
    repo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # Automatically archive all chat sessions associated with this repository
    db.query(ChatSession).filter(ChatSession.repo_id == repo_id).update(
        {ChatSession.is_archived: True, ChatSession.updated_at: datetime.datetime.utcnow()},
        synchronize_session=False
    )

    # Clean up local repository directory from disk
    git_service.delete_repository(repo.local_path)

    db.delete(repo)
    db.commit()
    return {"message": f"Repository '{repo.name}' removed from local registry and disk storage."}

@router.get("/repositories/{repo_id}/branches")
def get_repository_branches(
    repo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    try:
        branches_data = git_service.get_repository_branches(repo.local_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "repo_id": repo.id,
        "name": repo.name,
        "current_branch": branches_data.get("current_branch", repo.default_branch),
        "branches": branches_data.get("branches", [repo.default_branch])
    }

@router.post("/repositories/{repo_id}/branch")
def switch_repository_branch(
    repo_id: int,
    payload: RepoBranchPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    try:
        switch_result = git_service.switch_repository_branch(repo.local_path, payload.branch)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    repo.default_branch = switch_result.get("branch", payload.branch)
    repo.last_synced_at = datetime.datetime.utcnow()
    db.commit()

    return {
        "message": f"Repository '{repo.name}' switched to branch '{repo.default_branch}'.",
        "current_branch": repo.default_branch,
        "head_sha": switch_result.get("head_sha", ""),
        "commit_count": switch_result.get("commit_count", 0),
        "ingested_commits": switch_result.get("ingested_commits", 0)
    }

@router.post("/repositories/clone-stream")
def clone_repository_stream(
    payload: RepoCreatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    safe_name = git_service.sanitize_repo_name(payload.name)
    existing = db.query(LocalRepository).filter(LocalRepository.name == safe_name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Repository '{safe_name}' is already registered in local storage catalog.")

    def stream_generator():
        try:
            for event in git_service.clone_repository_with_progress(
                name=safe_name,
                remote_url=payload.remote_url,
                clone_type=payload.clone_type,
                default_branch=payload.default_branch
            ):
                if event.get("stage") == "completed" and "metadata" in event:
                    meta = event["metadata"]
                    with SessionLocal() as db_session:
                        repo = LocalRepository(
                            name=safe_name,
                            remote_url=payload.remote_url,
                            local_path=meta["local_path"],
                            clone_type=payload.clone_type,
                            default_branch=meta.get("branch", payload.default_branch),
                            last_synced_at=datetime.datetime.utcnow()
                        )
                        db_session.add(repo)
                        db_session.commit()
                        db_session.refresh(repo)
                        event["repo_id"] = repo.id
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            err_event = {"stage": "error", "percent": 0, "detail": str(e)}
            yield f"data: {json.dumps(err_event)}\n\n"

    return StreamingResponse(stream_generator(), media_type="text/event-stream")

