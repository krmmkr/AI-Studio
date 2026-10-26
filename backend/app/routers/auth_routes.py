from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.app.auth import verify_password, hash_password, create_access_token, get_current_user
from backend.app.database import get_db
from backend.app.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class CreateUserRequest(BaseModel):
    email: str
    password: str = "welcome123"
    role: str = "member"

class UpdateUserRoleRequest(BaseModel):
    role: str

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": user.role})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "role": user.role,
        }
    }

@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "role": current_user.role,
    }

@router.get("/users")
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.id.asc()).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "role": u.role,
            "status": "Active",
            "created_at": u.created_at.isoformat() if getattr(u, "created_at", None) else None,
        }
        for u in users
    ]

@router.post("/users")
def create_user(
    payload: CreateUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create users.")
    clean_email = payload.email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=400, detail="Valid email is required.")
    existing = db.query(User).filter(User.email == clean_email).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"User '{clean_email}' already exists.")
    role = payload.role if payload.role in ("admin", "member") else "member"
    new_u = User(
        email=clean_email,
        hashed_password=hash_password(payload.password or "welcome123"),
        role=role,
    )
    db.add(new_u)
    db.commit()
    db.refresh(new_u)
    return {
        "id": new_u.id,
        "email": new_u.email,
        "role": new_u.role,
        "status": "Active",
    }

@router.put("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    payload: UpdateUserRoleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can update user roles.")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    role = payload.role if payload.role in ("admin", "member") else "member"
    target.role = role
    db.commit()
    return {"id": target.id, "email": target.email, "role": target.role, "status": "Active"}

@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete users.")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own active account.")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    db.delete(target)
    db.commit()
    return {"status": "deleted", "id": user_id}
