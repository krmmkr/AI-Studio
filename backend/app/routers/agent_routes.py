from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import os
import json
import asyncio
import subprocess
import datetime
from backend.app.auth import get_current_user
from backend.app.database import get_db, SessionLocal
from backend.app.models import User, AgentPersona, LocalRepository
from backend.app.services.git_service import git_service

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
    return git_service.list_worktrees(repo.local_path)

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
        return {"message": "Worktree created successfully", "worktree": wt}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/repositories/{repo_id}")
def delete_repository(
    repo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

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

