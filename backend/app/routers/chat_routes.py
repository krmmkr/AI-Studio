import json
import uuid
import datetime
import asyncio
import re
import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_
from backend.app.auth import get_current_user
from backend.app.database import get_db, SessionLocal
from backend.app.models import User, ChatSession, ChatMessage, MCPConfig, Dashboard
from backend.app.services.antigravity_agent import antigravity_agent
from backend.app.services.agents.execution_manager import execution_manager
from backend.app.services.duckdb_service import duckdb_service

logger = logging.getLogger("chat_routes")

router = APIRouter(prefix="/api/chat", tags=["chat"])


def derive_title_from_prompt(prompt: str, max_length: int = 48) -> str:
    """
    Agor auto-title heuristic: derives a concise, readable title from user prompt.
    Strips raw code blocks, collapse whitespace, and cuts at a clean word boundary.
    """
    clean = re.sub(r"```[\s\S]*?```", "", prompt or "")
    clean = re.sub(r"\s+", " ", clean).strip()
    if not clean:
        return "New Exploration"
    if len(clean) <= max_length:
        return clean
    truncated = clean[:max_length]
    last_space = truncated.rfind(" ")
    if last_space > int(max_length * 0.4):
        truncated = truncated[:last_space]
    return f"{truncated}…"


def _parse_proposals_json(raw_json: str | None) -> tuple[list[dict[str, Any]] | None, list[dict[str, Any]] | None]:
    """Gracefully extracts proposals and user inquiries from persisted JSON column."""
    if not raw_json:
        return None, None
    try:
        data = json.loads(raw_json)
        if isinstance(data, dict):
            return data.get("proposals"), data.get("inquiries")
        elif isinstance(data, list):
            props = [x for x in data if x.get("type") == "dataset" or "sql_query" in x]
            inqs = [x for x in data if "question" in x or x.get("type") in ("question", "recommendation")]
            return props or None, inqs or None
    except Exception:
        pass
    return None, None

class ChatSessionCreate(BaseModel):
    title: str | None = "New Exploration"
    dashboard_id: str | None = None
    scope: str | None = "dashboard"
    pin_id: int | None = None
    widget_id: str | None = None
    agent_id: str | None = "general"
    parent_session_id: str | None = None
    fork_message_id: int | None = None

class ForkSessionPayload(BaseModel):
    message_id: int | None = None
    title: str | None = None

class AttachDashboardPayload(BaseModel):
    dashboard_id: str | None = None

class PromptPayload(BaseModel):
    message: str
    dashboard_id: str | None = None
    current_dashboard_id: str | None = None
    agent_id: str | None = "general"
    scope: str | None = None
    pin_id: int | None = None
    widget_id: str | None = None
    provider: str | None = None
    endpoint: str | None = None
    base_url: str | None = None
    model: str | None = None
    parent_session_id: str | None = None


@router.get("/runtime")
def get_runtime_info(current_user: User = Depends(get_current_user)):
    """Returns the active default LLM SDK provider and model configuration."""
    import os
    from backend.app.config import (
        LLM_PROVIDER,
        OPENCODE_MODEL,
        ANTIGRAVITY_MODEL,
        ANTIGRAVITY_BASE_URL,
    )

    active_provider = (os.environ.get("LLM_PROVIDER") or LLM_PROVIDER or "antigravity").strip().lower()
    if active_provider not in ("opencode", "antigravity"):
        active_provider = "antigravity"

    agy_model = os.environ.get("ANTIGRAVITY_MODEL") or ANTIGRAVITY_MODEL or "gemini-3.5-flash"
    agy_base_url = (os.environ.get("ANTIGRAVITY_BASE_URL") or ANTIGRAVITY_BASE_URL or "").strip()

    return {
        "default_provider": active_provider,
        "opencode_model": os.environ.get("OPENCODE_MODEL") or OPENCODE_MODEL or "opencode/big-pickle",
        "antigravity_model": agy_model,
        "antigravity_base_url": agy_base_url,
        "providers": [
            {
                "id": "opencode",
                "label": "OpenCode SDK",
                "model": os.environ.get("OPENCODE_MODEL") or OPENCODE_MODEL or "opencode/big-pickle",
            },
            {
                "id": "antigravity",
                "label": "Antigravity SDK",
                "model": agy_model,
                "base_url": agy_base_url or None,
            },
        ],
    }

@router.get("/sessions")
def list_sessions(
    dashboard_id: str | None = None,
    scope: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(ChatSession).filter(ChatSession.user_id == current_user.id)

    if scope:
        query = query.filter(ChatSession.scope == scope)
    elif not dashboard_id:
        # Hide localized pin popup chats from the main sidebar to prevent clutter
        query = query.filter(or_(ChatSession.scope != "pin", ChatSession.scope.is_(None)))

    sessions = query.order_by(ChatSession.updated_at.desc()).all()

    # Automatically attach any sessions started with dashboard assistant (dash-...)
    dashboards = None
    for s in sessions:
        if not s.dashboard_id and s.id.startswith("dash-"):
            if dashboards is None:
                dashboards = db.query(Dashboard).all()
            for d in dashboards:
                if d.id in s.id:
                    s.dashboard_id = d.id
                    db.commit()
                    break

    if dashboard_id:
        sessions = [s for s in sessions if s.dashboard_id == dashboard_id]

    parent_map = {s.id: s.title for s in sessions}

    return [
        {
            "id": s.id,
            "title": s.title,
            "agent_id": s.agent_id or "general",
            "parent_session_id": s.parent_session_id,
            "parent_title": parent_map.get(s.parent_session_id),
            "fork_message_id": s.fork_message_id,
            "status": s.status or "idle",
            "last_error": s.last_error,
            "dashboard_id": s.dashboard_id,
            "dashboard_title": s.dashboard.title if s.dashboard else None,
            "scope": s.scope or "dashboard",
            "pin_id": s.pin_id,
            "widget_id": s.widget_id,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            "message_count": len(s.messages)
        }
        for s in sessions
    ]

@router.post("/sessions")
def create_session(payload: ChatSessionCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session_id = str(uuid.uuid4())
    session = ChatSession(
        id=session_id,
        user_id=current_user.id,
        title=payload.title or "New Exploration",
        agent_id=payload.agent_id or "general",
        parent_session_id=payload.parent_session_id,
        fork_message_id=payload.fork_message_id,
        dashboard_id=payload.dashboard_id,
        scope=payload.scope or "dashboard",
        pin_id=payload.pin_id,
        widget_id=payload.widget_id
    )
    db.add(session)
    db.commit()
    dash_title = None
    if payload.dashboard_id:
        dash = db.query(Dashboard).filter(Dashboard.id == payload.dashboard_id).first()
        if dash:
            dash_title = dash.title
    return {
        "id": session.id,
        "title": session.title,
        "agent_id": session.agent_id or "general",
        "parent_session_id": session.parent_session_id,
        "fork_message_id": session.fork_message_id,
        "status": session.status or "idle",
        "last_error": session.last_error,
        "dashboard_id": session.dashboard_id,
        "dashboard_title": dash_title,
        "scope": session.scope,
        "pin_id": session.pin_id,
        "widget_id": session.widget_id,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "message_count": 0
    }

@router.post("/sessions/{session_id}/fork")
def fork_session(
    session_id: str,
    payload: ForkSessionPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Agor-style Session Forking:
    Creates an independent child exploration linked to parent_session_id,
    cloning dialogue history up to the selected fork point.
    """
    parent = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent session not found")

    query = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.asc())
    if payload.message_id:
        target_msg = db.query(ChatMessage).filter(ChatMessage.id == payload.message_id).first()
        if target_msg:
            query = query.filter(ChatMessage.created_at <= target_msg.created_at)

    messages_to_clone = query.all()

    fork_sid = str(uuid.uuid4())
    default_title = f"Branch of {parent.title}" if not parent.title.startswith("Branch of") else f"{parent.title} (Fork)"
    fork_title = payload.title or default_title
    if len(fork_title) > 60:
        fork_title = fork_title[:57] + "…"

    fork_point_id = payload.message_id or (messages_to_clone[-1].id if messages_to_clone else None)

    child_session = ChatSession(
        id=fork_sid,
        user_id=current_user.id,
        title=fork_title,
        agent_id=parent.agent_id or "general",
        parent_session_id=parent.id,
        fork_message_id=fork_point_id,
        dashboard_id=parent.dashboard_id,
        scope=parent.scope or "dashboard",
        pin_id=parent.pin_id,
        widget_id=parent.widget_id,
        status="idle",
    )
    db.add(child_session)
    db.flush()

    cloned_count = 0
    for m in messages_to_clone:
        cloned_msg = ChatMessage(
            session_id=fork_sid,
            role=m.role,
            content=m.content,
            thoughts=m.thoughts,
            tool_calls_json=m.tool_calls_json,
            proposals_json=m.proposals_json,
            created_at=m.created_at,
        )
        db.add(cloned_msg)
        cloned_count += 1

    db.commit()

    dash_title = None
    if child_session.dashboard_id:
        dash = db.query(Dashboard).filter(Dashboard.id == child_session.dashboard_id).first()
        if dash:
            dash_title = dash.title

    return {
        "id": child_session.id,
        "title": child_session.title,
        "agent_id": child_session.agent_id,
        "status": child_session.status or "idle",
        "parent_session_id": parent.id,
        "parent_title": parent.title,
        "fork_message_id": fork_point_id,
        "dashboard_id": child_session.dashboard_id,
        "dashboard_title": dash_title,
        "scope": child_session.scope,
        "pin_id": child_session.pin_id,
        "widget_id": child_session.widget_id,
        "cloned_message_count": cloned_count,
        "created_at": child_session.created_at.isoformat(),
        "updated_at": child_session.updated_at.isoformat() if child_session.updated_at else None,
        "message_count": cloned_count
    }

@router.put("/sessions/{session_id}/dashboard")
def attach_dashboard(session_id: str, payload: AttachDashboardPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.dashboard_id = payload.dashboard_id
    db.commit()
    dash_title = None
    if payload.dashboard_id:
        dash = db.query(Dashboard).filter(Dashboard.id == payload.dashboard_id).first()
        if dash:
            dash_title = dash.title
    return {"id": session.id, "dashboard_id": session.dashboard_id, "dashboard_title": dash_title}

@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.asc()).all()
    results = []
    for m in messages:
        props, inqs = _parse_proposals_json(m.proposals_json)
        results.append({
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "thoughts": m.thoughts,
            "tool_calls": json.loads(m.tool_calls_json) if m.tool_calls_json else None,
            "proposals": props,
            "inquiries": inqs,
            "created_at": m.created_at.isoformat() if m.created_at else None
        })
    return results

@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.delete(session)
    db.commit()
    return {"message": "Session deleted"}

@router.post("/sessions/{session_id}/stop")
async def stop_session_execution(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Immediately cancels active agent execution for the given chat session and resets state."""
    stopped = await execution_manager.stop_execution(session_id, reason="user_stopped")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if session:
        session.status = "idle"
        session.last_error = None
        session.updated_at = datetime.datetime.utcnow()
        db.commit()
    return {"session_id": session_id, "stopped": stopped, "status": "idle"}

@router.post("/sessions/{session_id}/stream")
async def stream_chat(
    session_id: str,
    payload: PromptPayload,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not session:
        # Gracefully auto-create session if streaming from a fresh client UUID
        dash_id_to_attach = payload.dashboard_id
        if not dash_id_to_attach and session_id.startswith("dash-"):
            for d in db.query(Dashboard).all():
                if d.id in session_id:
                    dash_id_to_attach = d.id
                    break
        elif not dash_id_to_attach and session_id.startswith("pin-"):
            for d in db.query(Dashboard).all():
                if d.id in session_id:
                    dash_id_to_attach = d.id
                    break

        is_pin = session_id.startswith("pin-") or payload.scope == "pin"
        scope_val = "pin" if is_pin else (payload.scope or "dashboard")
        pin_id_val = payload.pin_id
        if is_pin and not pin_id_val and session_id.startswith("pin-"):
            try:
                pin_id_val = int(session_id.split("-")[-1])
            except Exception:
                pass

        session = ChatSession(
            id=session_id,
            user_id=current_user.id,
            title=f"Pin #{pin_id_val} Chat" if pin_id_val else derive_title_from_prompt(payload.message),
            agent_id=payload.agent_id or "general",
            dashboard_id=dash_id_to_attach,
            scope=scope_val,
            pin_id=pin_id_val,
            widget_id=payload.widget_id,
            status="running",
            last_error=None,
        )
        db.add(session)
        db.commit()
    else:
        if session.title in ("New Chat", "New Exploration", "Untitled Chat"):
            session.title = derive_title_from_prompt(payload.message)
        if payload.agent_id and payload.agent_id != "general":
            session.agent_id = payload.agent_id
        if payload.scope and not session.scope:
            session.scope = payload.scope
        if payload.pin_id and not session.pin_id:
            session.pin_id = payload.pin_id
        if payload.widget_id and not session.widget_id:
            session.widget_id = payload.widget_id
        session.status = "running"
        session.last_error = None
        session.updated_at = datetime.datetime.utcnow()
        db.commit()

    # Save User message
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=payload.message
    )
    db.add(user_msg)
    db.commit()

    if not session.dashboard_id:
        if payload.dashboard_id:
            session.dashboard_id = payload.dashboard_id
            db.commit()
        elif session_id.startswith("dash-"):
            for d in db.query(Dashboard).all():
                if d.id in session_id:
                    session.dashboard_id = d.id
                    db.commit()
                    break

    # Collect active global and user-level MCP configs
    mcp_configs = db.query(MCPConfig).filter(
        or_(
            MCPConfig.scope == "global",
            MCPConfig.user_id == current_user.id
        ),
        MCPConfig.is_active == True
    ).all()

    target_dashboard_id = payload.dashboard_id if payload.dashboard_id is not None else session.dashboard_id

    # Load prior conversation history for this session (excluding the newly added message)
    prior_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id, ChatMessage.id != user_msg.id)
        .order_by(ChatMessage.created_at.asc())
        .limit(20)
        .all()
    )
    chat_history = [
        {"role": m.role, "content": m.content}
        for m in prior_messages
    ]

    # Resolve parent session context if this is a sub-task / subprocess branch
    parent_context = ""
    parent_sid = payload.parent_session_id or session.parent_session_id
    if parent_sid:
        if not session.parent_session_id:
            session.parent_session_id = parent_sid
            db.commit()
        p_msgs = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == parent_sid)
            .order_by(ChatMessage.created_at.desc())
            .limit(8)
            .all()
        )
        if p_msgs:
            p_msgs.reverse()
            parent_context = "\n".join(
                f"{m.role.upper()}: {m.content[:300] + ('...' if len(m.content) > 300 else '')}"
                for m in p_msgs
            )

    # Generator for SSE
    async def sse_event_generator():
        collected_thoughts = []
        collected_tool_calls = []
        collected_tokens = []
        collected_proposals = []
        collected_inquiries = []
        final_status = "completed"
        final_error = None

        timeout_seconds = 300.0  # 5 minutes hard limit per agent response
        exec_ctx = await execution_manager.start_execution(session_id, timeout_seconds=timeout_seconds)

        async def _watchdog():
            try:
                while not exec_ctx.is_cancelled:
                    await asyncio.sleep(1.0)
                    if await request.is_disconnected():
                        await exec_ctx.trigger_cancel(reason="client_disconnected")
                        break
                    if exec_ctx.is_timed_out:
                        await exec_ctx.trigger_cancel(reason="timeout")
                        break
            except asyncio.CancelledError:
                pass

        watchdog_task = asyncio.create_task(_watchdog())

        try:
            async for event in antigravity_agent.stream_chat(
                user_message=payload.message,
                history=chat_history,
                mcp_configs=mcp_configs,
                session_id=session_id,
                current_dashboard_id=target_dashboard_id,
                agent_id=payload.agent_id or session.agent_id or "general",
                scope=session.scope or payload.scope,
                pin_id=session.pin_id or payload.pin_id,
                widget_id=session.widget_id or payload.widget_id,
                execution_ctx=exec_ctx,
                provider_override=payload.provider,
                base_url=payload.base_url or payload.endpoint,
                model=payload.model,
                parent_context=parent_context,
                parent_session_id=parent_sid,
            ):
                if await request.is_disconnected():
                    await exec_ctx.trigger_cancel(reason="client_disconnected")
                    break

                if exec_ctx.is_cancelled:
                    if exec_ctx.cancel_reason == "timeout":
                        final_status = "timed_out"
                        final_error = "Execution auto-cancelled after 5 minutes (300s limit)."
                        yield f"data: {json.dumps({'type': 'thought', 'content': final_error})}\n\n"
                        timeout_note = "\n\n*(Execution auto-cancelled after reaching the 5-minute timeout.)*"
                        collected_tokens.append(timeout_note)
                        yield f"data: {json.dumps({'type': 'token', 'content': timeout_note})}\n\n"
                    elif exec_ctx.cancel_reason == "user_stopped":
                        final_status = "idle"
                        yield f"data: {json.dumps({'type': 'thought', 'content': 'Execution stopped by user.'})}\n\n"
                    break

                event_type = event.get("type")
                if event_type == "thought":
                    collected_thoughts.append(event["content"])
                elif event_type == "tool_call":
                    collected_tool_calls.append(event)
                elif event_type == "token":
                    collected_tokens.append(event["content"])
                elif event_type == "dataset_proposal":
                    prop = event.get("proposal") or event
                    collected_proposals.append(prop)
                    final_status = "awaiting_permission"
                    try:
                        with SessionLocal() as db_st:
                            s_row = db_st.query(ChatSession).filter(ChatSession.id == session_id).first()
                            if s_row:
                                s_row.status = "awaiting_permission"
                                db_st.commit()
                    except Exception:
                        pass
                elif event_type == "user_inquiry":
                    inq = event.get("inquiry") or event
                    collected_inquiries.append(inq)
                    final_status = "awaiting_permission"
                    try:
                        with SessionLocal() as db_st:
                            s_row = db_st.query(ChatSession).filter(ChatSession.id == session_id).first()
                            if s_row:
                                s_row.status = "awaiting_permission"
                                db_st.commit()
                    except Exception:
                        pass

                # Send SSE formatted chunk
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except asyncio.CancelledError:
            final_status = "idle"
            await exec_ctx.trigger_cancel(reason="client_disconnected")
        except Exception as e:
            final_status = "failed"
            final_error = str(e)
            err_notice = f"⚠️ **Streaming error**: `{e}`\n\n*Please try sending your request again.*"
            collected_tokens.append(err_notice)
            yield f"data: {json.dumps({'type': 'token', 'content': err_notice})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        finally:
            watchdog_task.cancel()
            execution_manager.finish_execution(session_id, exec_ctx)

        # Build proposal audit payload
        proposals_dict: dict[str, Any] = {}
        if collected_proposals:
            proposals_dict["proposals"] = collected_proposals
        if collected_inquiries:
            proposals_dict["inquiries"] = collected_inquiries
        proposals_json_str = json.dumps(proposals_dict, default=str) if proposals_dict else None

        # Determine terminal state: if any proposal is pending, status remains awaiting_permission
        if final_status == "completed" and (collected_proposals or collected_inquiries):
            has_pending = any(p.get("status") == "pending" for p in collected_proposals) or any(
                i.get("status") == "pending" for i in collected_inquiries
            )
            if has_pending:
                final_status = "awaiting_permission"

        # Save assistant message & update session status in DB
        full_content = "".join(collected_tokens)
        try:
            with SessionLocal() as db_save:
                s_row = db_save.query(ChatSession).filter(ChatSession.id == session_id).first()
                if s_row:
                    s_row.status = final_status
                    s_row.last_error = final_error
                    s_row.updated_at = datetime.datetime.utcnow()

                if full_content.strip() or collected_thoughts or proposals_dict:
                    assistant_msg = ChatMessage(
                        session_id=session_id,
                        role="assistant",
                        content=full_content or "*(Response completed)*",
                        thoughts="\n".join(collected_thoughts) if collected_thoughts else None,
                        tool_calls_json=json.dumps(collected_tool_calls, default=str) if collected_tool_calls else None,
                        proposals_json=proposals_json_str,
                    )
                    db_save.add(assistant_msg)
                elif final_error:
                    assistant_msg = ChatMessage(
                        session_id=session_id,
                        role="assistant",
                        content=f"⚠️ **Execution Notice**: {final_error}\n\n*Please try sending your request again.*",
                        thoughts="\n".join(collected_thoughts) if collected_thoughts else None,
                        tool_calls_json=json.dumps(collected_tool_calls, default=str) if collected_tool_calls else None,
                    )
                    db_save.add(assistant_msg)
                db_save.commit()
        except Exception as e:
            logger.error(f"Failed to persist assistant message / status: {e}")

    return StreamingResponse(sse_event_generator(), media_type="text/event-stream")


class ConfirmProposalRequest(BaseModel):
    proposal_id: str
    action: str  # 'approve' | 'decline'
    table_name: str
    sql_query: str | None = ""
    records: list[dict[str, Any]] | None = None
    description: str | None = None


@router.post("/proposals/confirm")
def confirm_proposal(
    payload: ConfirmProposalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Agor-style interactive permission resolution for agent proposals.
    Executes approved dataset queries or staged dynamic records with lineage audit, updates the persisted proposal
    record with approver identity and timestamp, and resets session state from awaiting_permission to idle.
    """
    now_iso = datetime.datetime.utcnow().isoformat()
    action_result = None

    user_email = "admin@antigravity.io"
    try:
        user_email = current_user.email
    except Exception:
        try:
            db_user = db.query(User).filter(User.id == current_user.id).first()
            if db_user:
                user_email = db_user.email
        except Exception:
            pass

    if payload.action == "approve":
        try:
            records = payload.records
            if not records:
                records = duckdb_service.get_staged_records(payload.table_name)
            if not records and payload.sql_query:
                q_res = duckdb_service.execute_query(payload.sql_query, limit=5000)
                if q_res.get("error"):
                    raise HTTPException(status_code=400, detail=q_res["error"])
                records = q_res.get("data", [])
            if not records:
                raise HTTPException(status_code=400, detail="No dataset records or SQL results available to materialize.")
            action_result = duckdb_service.materialize_dataset(
                table_name=payload.table_name,
                records=records,
                lineage={
                    "origin_type": "agent_derived",
                    "derivation_summary": payload.description or f"Dynamic dataset {payload.table_name}",
                    "source_query": payload.sql_query or f"SELECT * FROM {payload.table_name}",
                    "approved_by": user_email,
                    "approved_at": now_iso,
                },
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to materialize dataset: {e}")
    else:
        duckdb_service.clear_staged_records(payload.table_name)

    # Audit & update the matching ChatMessage row
    found_session_id = None
    target_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.proposals_json.isnot(None))
        .order_by(ChatMessage.created_at.desc())
        .limit(50)
        .all()
    )

    for m in target_messages:
        try:
            data = json.loads(m.proposals_json)
            updated = False
            # Check dict format {"proposals": [...]}
            if isinstance(data, dict) and "proposals" in data:
                for p in data["proposals"]:
                    if p.get("id") == payload.proposal_id:
                        p["status"] = "approved" if payload.action == "approve" else "declined"
                        p["approved_by"] = user_email
                        p["approved_at"] = now_iso
                        if action_result:
                            p["result"] = action_result
                        updated = True
            elif isinstance(data, list):
                for p in data:
                    if p.get("id") == payload.proposal_id:
                        p["status"] = "approved" if payload.action == "approve" else "declined"
                        p["approved_by"] = user_email
                        p["approved_at"] = now_iso
                        if action_result:
                            p["result"] = action_result
                        updated = True

            if updated:
                m.proposals_json = json.dumps(data)
                found_session_id = m.session_id
                db.commit()
                break
        except Exception:
            continue

    # If session was awaiting_permission, check if all proposals are resolved and return to idle
    if found_session_id:
        s_row = db.query(ChatSession).filter(ChatSession.id == found_session_id).first()
        if s_row and s_row.status == "awaiting_permission":
            s_row.status = "idle"
            s_row.updated_at = datetime.datetime.utcnow()
            db.commit()

    if payload.action == "approve":
        row_count = action_result.get("row_count") if action_result else 0
        return {
            "status": "approved",
            "proposal_id": payload.proposal_id,
            "table_name": payload.table_name,
            "message": f"Dataset '{payload.table_name}' materialized successfully ({row_count} rows).",
            "result": action_result,
        }
    else:
        return {
            "status": "declined",
            "proposal_id": payload.proposal_id,
            "table_name": payload.table_name,
            "message": f"Proposal to create '{payload.table_name}' was declined.",
        }

