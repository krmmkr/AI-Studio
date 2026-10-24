from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session
from sqlalchemy import or_
from backend.app.auth import get_current_user
from backend.app.database import get_db
from backend.app.models import User, MCPConfig
from backend.app.services.mcp_client import mcp_manager

router = APIRouter(prefix="/api/mcp", tags=["mcp"])

class MCPCreateRequest(BaseModel):
    name: str
    description: str | None = None
    scope: str = "user"  # 'global' or 'user'
    transport: str = "sse"  # 'sse' or 'http'
    url: str
    auth_header: str | None = None

class MCPTestRequest(BaseModel):
    url: str
    transport: str = "sse"
    auth_header: str | None = None

@router.get("")
def list_mcps(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List all global MCPs and MCPs owned by the current user."""
    configs = db.query(MCPConfig).filter(
        or_(
            MCPConfig.scope == "global",
            MCPConfig.user_id == current_user.id
        )
    ).all()
    
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "scope": c.scope,
            "transport": c.transport,
            "url": c.url,
            # Mask sensitive auth header if present
            "has_auth": bool(c.auth_header),
            "is_active": c.is_active,
            "is_owner": c.user_id == current_user.id,
            "created_at": c.created_at.isoformat() if c.created_at else None
        }
        for c in configs
    ]

@router.post("")
def create_mcp(payload: MCPCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Global configs can only be added by admins
    if payload.scope == "global" and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can add global MCP servers.")

    config = MCPConfig(
        name=payload.name,
        description=payload.description,
        scope=payload.scope,
        transport=payload.transport,
        url=str(payload.url),
        auth_header=payload.auth_header,
        is_active=True,
        user_id=current_user.id if payload.scope == "user" else None
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return {"message": "MCP server configured successfully", "id": config.id}

@router.put("/{mcp_id}/toggle")
def toggle_mcp(mcp_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    config = db.query(MCPConfig).filter(MCPConfig.id == mcp_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="MCP config not found")
    if config.scope == "global" and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Cannot toggle global configuration")
    if config.scope == "user" and config.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    config.is_active = not config.is_active
    db.commit()
    return {"id": config.id, "is_active": config.is_active}

@router.delete("/{mcp_id}")
def delete_mcp(mcp_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    config = db.query(MCPConfig).filter(MCPConfig.id == mcp_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="MCP config not found")
    if config.scope == "global" and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Cannot delete global configuration")
    if config.scope == "user" and config.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    db.delete(config)
    db.commit()
    return {"message": "MCP server removed"}

@router.post("/test")
async def test_mcp(payload: MCPTestRequest):
    result = await mcp_manager.test_endpoint(
        url=payload.url,
        transport=payload.transport,
        auth_header=payload.auth_header
    )
    return result

@router.get("/tools")
async def get_active_tools(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    configs = db.query(MCPConfig).filter(
        or_(
            MCPConfig.scope == "global",
            MCPConfig.user_id == current_user.id
        ),
        MCPConfig.is_active == True
    ).all()
    
    cfg_dicts = [{"name": c.name, "url": c.url, "transport": c.transport} for c in configs]
    tools = await mcp_manager.list_tools_for_configs(cfg_dicts)
    return tools
