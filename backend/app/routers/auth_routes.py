import json
import logging
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.app.auth import verify_password, hash_password, create_access_token, get_current_user
from backend.app.config import (
    is_auth_enabled,
    DEFAULT_ADMIN_EMAIL,
    APP_BASE_URL,
)
from backend.app.database import get_db
from backend.app.models import User
from backend.app.services.oidc_service import oidc_service

logger = logging.getLogger("auth_routes")
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

class OIDCCallbackPayload(BaseModel):
    code: str
    state: str
    redirect_uri: str | None = None

@router.get("/config")
def get_auth_config():
    """
    Returns public authentication metadata:
    - auth: boolean (True = SSO enforced; False = SSO disabled for local dev/testing)
    - sso_enabled: boolean
    - oidc_configured: boolean (whether IdP client_id / issuer are present)
    """
    auth_enabled = is_auth_enabled()
    oidc_configured = oidc_service.is_configured()
    return {
        "auth": auth_enabled,
        "auth_enabled": auth_enabled,
        "sso_enabled": auth_enabled,
        "oidc_configured": oidc_configured,
        "login_url": "/api/auth/oidc/login",
        "default_admin_email": DEFAULT_ADMIN_EMAIL,
    }

@router.get("/oidc/login")
async def oidc_login(
    redirect_uri: str | None = Query(None),
    return_to: str = Query("/"),
    mock: bool = Query(False),
):
    """
    Initiates OIDC Single Sign-On flow.
    Generates PKCE challenge and state parameter, then redirects to IdP.
    """
    if not oidc_service.is_configured() and not mock:
        return HTMLResponse(
            """<!DOCTYPE html>
            <html>
            <head><title>OIDC Configuration Required</title></head>
            <body style="background:#0f111a;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;padding:32px;line-height:1.5;">
              <div style="max-width:540px;margin:40px auto;background:#1e293b;border-radius:20px;padding:32px;border:1px solid rgba(255,255,255,0.1);text-align:center;">
                <div style="font-size:40px;margin-bottom:12px;">🔐</div>
                <h3 style="margin:0 0 8px 0;font-size:18px;color:#818cf8;">OpenID Connect (OIDC) Not Yet Configured</h3>
                <p style="color:#94a3b8;font-size:13px;margin:0 0 20px 0;">
                  Single Sign-On is active (<code>AUTH=true</code>). To connect your identity provider (Google, Okta, Keycloak, Azure AD), add these variables to your <code>.env</code>:
                </p>
                <div style="background:#0f172a;border-radius:10px;padding:14px;font-family:monospace;font-size:12px;color:#c084fc;text-align:left;margin-bottom:20px;">
                  OIDC_ISSUER_URL=https://accounts.google.com<br/>
                  OIDC_CLIENT_ID=your-client-id<br/>
                  OIDC_CLIENT_SECRET=your-client-secret
                </div>
                <div style="display:flex;gap:12px;justify-content:center;">
                  <a href="/api/auth/oidc/login?mock=true" style="display:inline-block;padding:10px 18px;background:#6366f1;color:#fff;border-radius:10px;text-decoration:none;font-size:12px;font-weight:600;">Test with Mock SSO User</a>
                  <a href="/" style="display:inline-block;padding:10px 18px;background:#334155;color:#e2e8f0;border-radius:10px;text-decoration:none;font-size:12px;">Return to Login</a>
                </div>
              </div>
            </body>
            </html>""",
            status_code=200,
        )

    try:
        auth_url, _ = await oidc_service.build_authorization_url(
            redirect_uri_override=redirect_uri,
            return_to=return_to,
            mock=mock,
        )
        return RedirectResponse(url=auth_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    except Exception as e:
        logger.error(f"Error generating OIDC authorization URL: {e}")
        return HTMLResponse(
            f"""<!DOCTYPE html><html><body style="background:#0f111a;color:#ef4444;font-family:system-ui;padding:40px;text-align:center;">
            <h3>OIDC Initiation Error</h3><p style="color:#94a3b8;">{str(e)}</p>
            <a href="/" style="color:#818cf8;">Return to AI Studio</a></body></html>""",
            status_code=500,
        )

@router.get("/oidc/callback")
async def oidc_callback_get(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """
    Handles browser redirect from OIDC Identity Provider with authorization code.
    Exchanges code for tokens, provisions/authenticates user, and persists session token.
    """
    if error:
        detail = error_description or error or "OIDC login canceled or rejected"
        return HTMLResponse(
            f"""<!DOCTYPE html><html><body style="background:#0f111a;color:#ef4444;font-family:system-ui;padding:40px;text-align:center;">
            <h3>Authentication Error</h3><p style="color:#94a3b8;">{detail}</p>
            <a href="/" style="color:#818cf8;">Return to AI Studio</a></body></html>""",
            status_code=400,
        )

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing required 'code' or 'state' parameter.")

    try:
        user_info = await oidc_service.exchange_code_for_user_info(code=code, state_token=state)
        user = oidc_service.find_or_provision_user(user_info, db)
        access_token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": user.role})
    except Exception as e:
        logger.error(f"OIDC callback exchange failure: {e}")
        return HTMLResponse(
            f"""<!DOCTYPE html><html><body style="background:#0f111a;color:#ef4444;font-family:system-ui;padding:40px;text-align:center;">
            <h3>SSO Authentication Failed</h3><p style="color:#94a3b8;">{str(e)}</p>
            <a href="/" style="color:#818cf8;">Return to Login</a></body></html>""",
            status_code=400,
        )

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Signing in to AI Studio...</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {{
      background: #0f111a;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }}
    .card {{
      background: #1e293b;
      padding: 32px;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      text-align: center;
      max-width: 420px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }}
    .spinner {{
      width: 36px;
      height: 36px;
      border: 3px solid rgba(99, 102, 241, 0.2);
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }}
    @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h3 style="margin: 0 0 8px 0; font-size: 18px;">Authentication Successful</h3>
    <p style="color: #94a3b8; font-size: 13px; margin: 0;">Launching your AI Studio workspace...</p>
  </div>
  <script>
    try {{
      localStorage.setItem('antigravity_token', {json.dumps(access_token)});
    }} catch (e) {{}}
    window.location.replace('/?token=' + encodeURIComponent({json.dumps(access_token)}));
  </script>
</body>
</html>"""
    return HTMLResponse(content=html_content, status_code=200)

@router.post("/oidc/callback", response_model=TokenResponse)
@router.post("/oidc/token", response_model=TokenResponse)
async def oidc_token_exchange_post(
    payload: OIDCCallbackPayload,
    db: Session = Depends(get_db),
):
    """Programmatic API endpoint to exchange OIDC code and state for an AI Studio session token."""
    try:
        user_info = await oidc_service.exchange_code_for_user_info(
            code=payload.code,
            state_token=payload.state,
            redirect_uri_override=payload.redirect_uri,
        )
        user = oidc_service.find_or_provision_user(user_info, db)
        access_token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": user.role})
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "role": user.role,
            },
        }
    except Exception as e:
        logger.error(f"POST OIDC token exchange failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

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
