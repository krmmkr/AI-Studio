from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import os
import subprocess
import datetime
from backend.app.auth import get_current_user
from backend.app.database import get_db
from backend.app.models import User, AgentPersona, LocalRepository

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
    default_branch: str = "main"

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
    return [
        {
            "id": r.id,
            "name": r.name,
            "remote_url": r.remote_url,
            "local_path": r.local_path,
            "clone_type": r.clone_type,
            "default_branch": r.default_branch,
            "last_synced_at": r.last_synced_at.isoformat() if r.last_synced_at else None
        }
        for r in repos
    ]

@router.post("/repositories")
def register_repository(
    payload: RepoCreatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    existing = db.query(LocalRepository).filter(LocalRepository.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Repository with this name already registered")

    local_path = f"/local_data/repos/{payload.name}"
    repo = LocalRepository(
        name=payload.name,
        remote_url=payload.remote_url,
        local_path=local_path,
        clone_type=payload.clone_type,
        default_branch=payload.default_branch
    )
    db.add(repo)
    db.commit()
    return {"message": "Repository registered in local storage catalog", "id": repo.id, "local_path": local_path}

@router.post("/repositories/{repo_id}/sync")
def sync_repository(
    repo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    repo.last_synced_at = datetime.datetime.utcnow()
    db.commit()
    return {"message": f"Repository '{repo.name}' synced successfully", "last_synced_at": repo.last_synced_at.isoformat()}

@router.delete("/repositories/{repo_id}")
def delete_repository(
    repo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    repo = db.query(LocalRepository).filter(LocalRepository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    db.delete(repo)
    db.commit()
    return {"message": f"Repository '{repo.name}' removed from local registry"}
