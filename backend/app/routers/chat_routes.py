import json
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_
from backend.app.auth import get_current_user
from backend.app.database import get_db
from backend.app.models import User, ChatSession, ChatMessage, MCPConfig
from backend.app.services.antigravity_agent import antigravity_agent

router = APIRouter(prefix="/api/chat", tags=["chat"])

class ChatSessionCreate(BaseModel):
    title: str | None = "New Exploration"

class PromptPayload(BaseModel):
    message: str
    dashboard_id: str | None = None
    agent_id: str | None = "general"

@router.get("/sessions")
def list_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id
    ).order_by(ChatSession.updated_at.desc()).all()
    return [
        {
            "id": s.id,
            "title": s.title,
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
        title=payload.title or "New Exploration"
    )
    db.add(session)
    db.commit()
    return {"id": session.id, "title": session.title}

@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.asc()).all()
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "thoughts": m.thoughts,
            "tool_calls": json.loads(m.tool_calls_json) if m.tool_calls_json else None,
            "created_at": m.created_at.isoformat() if m.created_at else None
        }
        for m in messages
    ]

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

@router.post("/sessions/{session_id}/stream")
async def stream_chat(
    session_id: str,
    payload: PromptPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Save User message
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=payload.message
    )
    db.add(user_msg)
    db.commit()

    # Collect active global and user-level MCP configs
    mcp_configs = db.query(MCPConfig).filter(
        or_(
            MCPConfig.scope == "global",
            MCPConfig.user_id == current_user.id
        ),
        MCPConfig.is_active == True
    ).all()

    # Generator for SSE
    async def sse_event_generator():
        collected_thoughts = []
        collected_tool_calls = []
        collected_tokens = []

        async for event in antigravity_agent.stream_chat(
            user_message=payload.message,
            history=[],
            mcp_configs=mcp_configs,
            current_dashboard_id=payload.dashboard_id,
            agent_id=payload.agent_id
        ):
            event_type = event.get("type")
            if event_type == "thought":
                collected_thoughts.append(event["content"])
            elif event_type == "tool_call":
                collected_tool_calls.append(event)
            elif event_type == "token":
                collected_tokens.append(event["content"])

            # Send SSE formatted chunk
            yield f"data: {json.dumps(event, default=str)}\n\n"

        # Save assistant message to DB
        full_content = "".join(collected_tokens)
        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=full_content,
            thoughts="\n".join(collected_thoughts) if collected_thoughts else None,
            tool_calls_json=json.dumps(collected_tool_calls, default=str) if collected_tool_calls else None
        )
        db.add(assistant_msg)
        db.commit()

    return StreamingResponse(sse_event_generator(), media_type="text/event-stream")
