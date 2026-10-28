import datetime
import logging
from urllib.parse import quote
from typing import Any
import jwt
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from backend.app.auth import (
    get_current_user,
    encrypt_secret,
    decrypt_secret,
    hash_password,
    verify_password,
)
from backend.app.config import (
    JWT_SECRET,
    JWT_ALGORITHM,
    ATLASSIAN_CLIENT_ID,
    ATLASSIAN_CLIENT_SECRET,
    GITHUB_OAUTH_CLIENT_ID,
    GITHUB_OAUTH_CLIENT_SECRET,
    APP_BASE_URL,
)
from backend.app.database import get_db
from backend.app.models import User, UserSetting

logger = logging.getLogger("user_routes")
router = APIRouter()


def mask_secret(secret: str | None, prefix_len: int = 4, suffix_len: int = 3) -> str | None:
    """Masks secret values for safe frontend rendering without leaking raw keys."""
    if not secret:
        return None
    if len(secret) <= prefix_len + suffix_len:
        return "••••••••"
    return f"{secret[:prefix_len]}••••••••{secret[-suffix_len:]}"


def is_masked_placeholder(val: str | None) -> bool:
    """Detects if client sent back a masked placeholder string (indicating no change)."""
    if not val:
        return False
    return "••••" in val


class UpdateUserSettingsPayload(BaseModel):
    git_name: str | None = None
    git_email: str | None = None

    # GitHub
    github_token: str | None = None
    github_username: str | None = None
    github_auth_type: str | None = None

    # Atlassian Jira / Confluence
    jira_url: str | None = None
    jira_email: str | None = None
    jira_token: str | None = None
    jira_cloud_id: str | None = None
    jira_auth_type: str | None = None

    # AI Provider BYOK
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    deepseek_api_key: str | None = None
    gemini_api_key: str | None = None

    # Superset
    superset_username: str | None = None
    superset_password: str | None = None


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


def get_or_create_user_setting(user_id: int, db: Session) -> UserSetting:
    setting = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
    if not setting:
        setting = UserSetting(user_id=user_id)
        db.add(setting)
        db.commit()
        db.refresh(setting)
    return setting


@router.get("/settings")
def get_user_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns sanitized settings, git identities, and connection statuses for current user.
    All secret tokens are masked to protect confidential keys.
    """
    setting = get_or_create_user_setting(current_user.id, db)

    # Decrypt stored secrets safely to generate representative masks
    raw_gh = decrypt_secret(setting.github_token)
    raw_jira = decrypt_secret(setting.jira_token)
    raw_anthropic = decrypt_secret(setting.anthropic_api_key)
    raw_openai = decrypt_secret(setting.openai_api_key)
    raw_deepseek = decrypt_secret(setting.deepseek_api_key)
    raw_gemini = decrypt_secret(setting.gemini_api_key)
    raw_superset_pw = decrypt_secret(setting.superset_password)

    return {
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "role": current_user.role,
            "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        },
        "git": {
            "name": setting.git_name or "",
            "email": setting.git_email or current_user.email,
        },
        "integrations": {
            "github": {
                "has_token": bool(raw_gh),
                "masked_token": mask_secret(raw_gh, prefix_len=4, suffix_len=3),
                "username": setting.github_username or "",
                "auth_type": setting.github_auth_type or "pat",
                "oauth_configured": bool(GITHUB_OAUTH_CLIENT_ID),
            },
            "jira": {
                "has_token": bool(raw_jira),
                "masked_token": mask_secret(raw_jira, prefix_len=3, suffix_len=3),
                "url": setting.jira_url or "",
                "email": setting.jira_email or "",
                "cloud_id": setting.jira_cloud_id or "",
                "auth_type": setting.jira_auth_type or "token",
                "oauth_configured": bool(ATLASSIAN_CLIENT_ID),
                "token_expires_at": setting.jira_token_expires_at.isoformat() if setting.jira_token_expires_at else None,
            },
            "byok": {
                "anthropic": {
                    "has_key": bool(raw_anthropic),
                    "masked_key": mask_secret(raw_anthropic, prefix_len=7, suffix_len=3),
                },
                "openai": {
                    "has_key": bool(raw_openai),
                    "masked_key": mask_secret(raw_openai, prefix_len=7, suffix_len=3),
                },
                "deepseek": {
                    "has_key": bool(raw_deepseek),
                    "masked_key": mask_secret(raw_deepseek, prefix_len=4, suffix_len=3),
                },
                "gemini": {
                    "has_key": bool(raw_gemini),
                    "masked_key": mask_secret(raw_gemini, prefix_len=4, suffix_len=3),
                },
            },
            "superset": {
                "username": setting.superset_username or "",
                "has_password": bool(raw_superset_pw),
            },
        },
        "oauth_providers": {
            "atlassian": {
                "configured": bool(ATLASSIAN_CLIENT_ID),
                "login_url": f"/api/user/oauth/atlassian/login",
            },
            "github": {
                "configured": bool(GITHUB_OAUTH_CLIENT_ID),
                "login_url": f"/api/user/oauth/github/login",
            },
        },
        "updated_at": setting.updated_at.isoformat() if setting.updated_at else None,
    }


@router.put("/settings")
def update_user_settings(
    payload: UpdateUserSettingsPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Updates the active user's credentials, git signature, and service keys.
    Sensitive tokens are encrypted at rest via AES-256 / Fernet.
    """
    setting = get_or_create_user_setting(current_user.id, db)

    # Git identity
    if payload.git_name is not None:
        setting.git_name = payload.git_name.strip()
    if payload.git_email is not None:
        setting.git_email = payload.git_email.strip()

    # GitHub
    if payload.github_username is not None:
        setting.github_username = payload.github_username.strip()
    if payload.github_auth_type is not None:
        setting.github_auth_type = payload.github_auth_type.strip()
    if payload.github_token is not None:
        token_val = payload.github_token.strip()
        if token_val == "":
            setting.github_token = None
        elif not is_masked_placeholder(token_val):
            setting.github_token = encrypt_secret(token_val)

    # Jira / Atlassian
    if payload.jira_url is not None:
        setting.jira_url = payload.jira_url.strip()
    if payload.jira_email is not None:
        setting.jira_email = payload.jira_email.strip()
    if payload.jira_cloud_id is not None:
        setting.jira_cloud_id = payload.jira_cloud_id.strip()
    if payload.jira_auth_type is not None:
        setting.jira_auth_type = payload.jira_auth_type.strip()
    if payload.jira_token is not None:
        token_val = payload.jira_token.strip()
        if token_val == "":
            setting.jira_token = None
            setting.jira_refresh_token = None
        elif not is_masked_placeholder(token_val):
            setting.jira_token = encrypt_secret(token_val)

    # AI Provider BYOK
    if payload.anthropic_api_key is not None:
        val = payload.anthropic_api_key.strip()
        if val == "":
            setting.anthropic_api_key = None
        elif not is_masked_placeholder(val):
            setting.anthropic_api_key = encrypt_secret(val)

    if payload.openai_api_key is not None:
        val = payload.openai_api_key.strip()
        if val == "":
            setting.openai_api_key = None
        elif not is_masked_placeholder(val):
            setting.openai_api_key = encrypt_secret(val)

    if payload.deepseek_api_key is not None:
        val = payload.deepseek_api_key.strip()
        if val == "":
            setting.deepseek_api_key = None
        elif not is_masked_placeholder(val):
            setting.deepseek_api_key = encrypt_secret(val)

    if payload.gemini_api_key is not None:
        val = payload.gemini_api_key.strip()
        if val == "":
            setting.gemini_api_key = None
        elif not is_masked_placeholder(val):
            setting.gemini_api_key = encrypt_secret(val)

    # Superset
    if payload.superset_username is not None:
        setting.superset_username = payload.superset_username.strip()
    if payload.superset_password is not None:
        val = payload.superset_password.strip()
        if val == "":
            setting.superset_password = None
        elif not is_masked_placeholder(val):
            setting.superset_password = encrypt_secret(val)

    setting.updated_at = datetime.datetime.utcnow()
    db.commit()

    return {"message": "User settings updated successfully"}


@router.post("/change-password")
def change_password(
    payload: ChangePasswordPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Allows self-service password update for the authenticated user."""
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password does not match")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


@router.post("/oauth/{provider}/disconnect")
def disconnect_oauth_provider(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Disconnects an active OAuth connection and purges encrypted tokens."""
    setting = get_or_create_user_setting(current_user.id, db)
    provider = provider.lower()

    if provider in ("atlassian", "jira"):
        setting.jira_token = None
        setting.jira_refresh_token = None
        setting.jira_cloud_id = None
        setting.jira_auth_type = "token"
        setting.jira_token_expires_at = None
        db.commit()
        return {"message": "Disconnected Atlassian Jira integration"}
    elif provider == "github":
        setting.github_token = None
        setting.github_username = None
        setting.github_auth_type = "pat"
        db.commit()
        return {"message": "Disconnected GitHub integration"}
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported OAuth provider: {provider}")


# ---------------------------------------------------------------------------
# Browser OAuth 2.0 Flow (Atlassian Jira MCP & GitHub)
# ---------------------------------------------------------------------------

def generate_oauth_state(user_id: int, provider: str) -> str:
    """Generates a signed, tamper-proof state token with short expiration."""
    exp = datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
    return jwt.encode({"sub": str(user_id), "provider": provider, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_oauth_state(state: str, expected_provider: str) -> int:
    """Decodes and validates OAuth state parameter to prevent CSRF attacks."""
    try:
        payload = jwt.decode(state, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("provider") != expected_provider:
            raise ValueError("Provider mismatch")
        return int(payload["sub"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid or expired OAuth state parameter: {e}")


@router.get("/oauth/atlassian/login")
def atlassian_oauth_login(
    token: str | None = Query(None),
    current_user: User = Depends(get_current_user),
):
    """
    Initiates Browser OAuth 2.0 (3LO) flow with Atlassian Cloud.
    Redirects user to auth.atlassian.com consent screen.
    """
    if not ATLASSIAN_CLIENT_ID:
        return HTMLResponse(
            """<!DOCTYPE html>
            <html>
            <head><title>Atlassian OAuth Setup</title></head>
            <body style="background:#0f111a;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;padding:32px;line-height:1.5;">
              <div style="max-width:500px;margin:20px auto;background:#1e293b;border-radius:16px;padding:24px;border:1px solid rgba(255,255,255,0.1);text-align:center;">
                <div style="font-size:36px;margin-bottom:12px;">🌐</div>
                <h3 style="margin:0 0 8px 0;font-size:16px;color:#60a5fa;">Atlassian OAuth 2.0 App Not Configured</h3>
                <p style="color:#94a3b8;font-size:13px;margin:0 0 16px 0;">
                  Browser 1-click authorization requires an Atlassian OAuth 2.0 Client ID in your server <code>.env</code>:
                </p>
                <div style="background:#0f172a;border-radius:8px;padding:12px;font-family:monospace;font-size:11px;color:#38bdf8;text-align:left;margin-bottom:16px;">
                  ATLASSIAN_CLIENT_ID=your_client_id<br/>
                  ATLASSIAN_CLIENT_SECRET=your_client_secret
                </div>
                <div style="background:rgba(59,130,246,0.1);border-radius:8px;padding:12px;font-size:12px;color:#93c5fd;text-align:left;margin-bottom:20px;">
                  💡 <b>Instant Connection:</b> You can connect right now without any OAuth app by toggling <b>"Or use API Token"</b> in the User Settings modal!
                </div>
                <button onclick="window.close()" style="padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer;">
                  Close Window & Use API Token
                </button>
              </div>
            </body>
            </html>"""
        )

    redirect_uri = f"{APP_BASE_URL}/api/user/oauth/atlassian/callback"
    state = generate_oauth_state(current_user.id, "atlassian")
    scopes = "read:jira-work write:jira-work read:jira-user offline_access"

    auth_url = (
        f"https://auth.atlassian.com/authorize?"
        f"audience=api.atlassian.com&"
        f"client_id={quote(ATLASSIAN_CLIENT_ID)}&"
        f"scope={quote(scopes)}&"
        f"redirect_uri={quote(redirect_uri)}&"
        f"state={quote(state)}&"
        f"response_type=code&"
        f"prompt=consent"
    )
    return RedirectResponse(auth_url)


@router.get("/oauth/atlassian/callback")
async def atlassian_oauth_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    db: Session = Depends(get_db)
):
    """Handles authorization redirect from Atlassian and exchanges code for access & refresh tokens."""
    if error or not code or not state:
        err_msg = error_description or error or "Authorization was denied by user"
        return HTMLResponse(
            f"""<!DOCTYPE html><html><body style="background:#0f111a;color:#ff6b6b;font-family:system-ui;text-align:center;padding:40px;">
            <h3>Authentication Cancelled</h3><p>{err_msg}</p>
            <script>if (window.opener) {{ window.opener.postMessage({{ type: 'oauth_error', error: '{err_msg}' }}, '*'); setTimeout(() => window.close(), 2000); }}</script>
            </body></html>"""
        )

    user_id = verify_oauth_state(state, "atlassian")
    redirect_uri = f"{APP_BASE_URL}/api/user/oauth/atlassian/callback"

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1. Exchange authorization code for token pair
        token_res = await client.post(
            "https://auth.atlassian.com/oauth/token",
            json={
                "grant_type": "authorization_code",
                "client_id": ATLASSIAN_CLIENT_ID,
                "client_secret": ATLASSIAN_CLIENT_SECRET,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        if token_res.status_code != 200:
            logger.error(f"Failed to exchange Atlassian code: {token_res.text}")
            return HTMLResponse(f"Failed to exchange authorization code: {token_res.text}", status_code=400)

        token_data = token_res.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = int(token_data.get("expires_in", 3600))
        expires_at = datetime.datetime.utcnow() + datetime.timedelta(seconds=expires_in)

        # 2. Query accessible resources to determine cloudId and site URL
        cloud_id = None
        site_url = None
        try:
            res_res = await client.get(
                "https://api.atlassian.com/oauth/token/accessible-resources",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
            )
            if res_res.status_code == 200:
                resources = res_res.json()
                if resources and isinstance(resources, list) and len(resources) > 0:
                    cloud_id = resources[0].get("id")
                    site_url = resources[0].get("url")
        except Exception as e:
            logger.warning(f"Could not fetch accessible resources for Jira: {e}")

    # 3. Store encrypted tokens in database
    setting = get_or_create_user_setting(user_id, db)
    setting.jira_token = encrypt_secret(access_token)
    if refresh_token:
        setting.jira_refresh_token = encrypt_secret(refresh_token)
    if cloud_id:
        setting.jira_cloud_id = cloud_id
    if site_url and not setting.jira_url:
        setting.jira_url = site_url
    setting.jira_auth_type = "oauth"
    setting.jira_token_expires_at = expires_at
    setting.updated_at = datetime.datetime.utcnow()
    db.commit()

    return HTMLResponse(
        """<!DOCTYPE html><html><body style="background:#0f111a;color:#4ade80;font-family:system-ui;text-align:center;padding:50px;">
        <h2>✓ Successfully Connected to Atlassian Jira!</h2>
        <p style="color:#94a3b8;">Your browser session is linked. Closing this window...</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'oauth_success', provider: 'atlassian' }, '*');
            setTimeout(() => window.close(), 1200);
          }
        </script>
        </body></html>"""
    )


@router.get("/oauth/github/login")
def github_oauth_login(
    token: str | None = Query(None),
    current_user: User = Depends(get_current_user),
):
    """Initiates GitHub Browser OAuth flow."""
    if not GITHUB_OAUTH_CLIENT_ID:
        return HTMLResponse(
            """<!DOCTYPE html>
            <html>
            <head><title>GitHub OAuth Setup</title></head>
            <body style="background:#0f111a;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;padding:32px;line-height:1.5;">
              <div style="max-width:500px;margin:20px auto;background:#1e293b;border-radius:16px;padding:24px;border:1px solid rgba(255,255,255,0.1);text-align:center;">
                <div style="font-size:36px;margin-bottom:12px;">🐙</div>
                <h3 style="margin:0 0 8px 0;font-size:16px;color:#c084fc;">GitHub OAuth App Not Configured</h3>
                <p style="color:#94a3b8;font-size:13px;margin:0 0 16px 0;">
                  Browser 1-click authorization requires a GitHub OAuth App in your server <code>.env</code>:
                </p>
                <div style="background:#0f172a;border-radius:8px;padding:12px;font-family:monospace;font-size:11px;color:#c084fc;text-align:left;margin-bottom:16px;">
                  GITHUB_OAUTH_CLIENT_ID=your_client_id<br/>
                  GITHUB_OAUTH_CLIENT_SECRET=your_client_secret
                </div>
                <div style="background:rgba(168,85,247,0.1);border-radius:8px;padding:12px;font-size:12px;color:#d8b4fe;text-align:left;margin-bottom:20px;">
                  💡 <b>Instant Connection:</b> You can connect right now without an OAuth app by toggling <b>"Or use GitHub PAT"</b> in User Settings!
                </div>
                <button onclick="window.close()" style="padding:10px 24px;background:#9333ea;color:#fff;border:none;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer;">
                  Close Window & Use PAT
                </button>
              </div>
            </body>
            </html>"""
        )

    redirect_uri = f"{APP_BASE_URL}/api/user/oauth/github/callback"
    state = generate_oauth_state(current_user.id, "github")
    auth_url = (
        f"https://github.com/login/oauth/authorize?"
        f"client_id={quote(GITHUB_OAUTH_CLIENT_ID)}&"
        f"scope=repo%2Cread%3Aorg&"
        f"redirect_uri={quote(redirect_uri)}&"
        f"state={quote(state)}"
    )
    return RedirectResponse(auth_url)


@router.get("/oauth/github/callback")
async def github_oauth_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    db: Session = Depends(get_db)
):
    """Handles authorization redirect from GitHub and exchanges code for access token."""
    if error or not code or not state:
        err_msg = error_description or error or "GitHub authorization cancelled"
        return HTMLResponse(
            f"""<!DOCTYPE html><html><body style="background:#0f111a;color:#ff6b6b;font-family:system-ui;text-align:center;padding:40px;">
            <h3>GitHub Authentication Failed</h3><p>{err_msg}</p>
            <script>if (window.opener) {{ window.opener.postMessage({{ type: 'oauth_error', error: '{err_msg}' }}, '*'); setTimeout(() => window.close(), 2000); }}</script>
            </body></html>"""
        )

    user_id = verify_oauth_state(state, "github")
    redirect_uri = f"{APP_BASE_URL}/api/user/oauth/github/callback"

    async with httpx.AsyncClient(timeout=15.0) as client:
        token_res = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": GITHUB_OAUTH_CLIENT_ID,
                "client_secret": GITHUB_OAUTH_CLIENT_SECRET,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        if token_res.status_code != 200:
            return HTMLResponse(f"Failed to exchange GitHub authorization code: {token_res.text}", status_code=400)

        token_data = token_res.json()
        access_token = token_data.get("access_token")
        if not access_token:
            return HTMLResponse(f"GitHub did not return an access token: {token_data}", status_code=400)

        # Query user profile to store GitHub username
        username = None
        try:
            user_res = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {access_token}", "User-Agent": "Cockpit-AI"}
            )
            if user_res.status_code == 200:
                username = user_res.json().get("login")
        except Exception:
            pass

    setting = get_or_create_user_setting(user_id, db)
    setting.github_token = encrypt_secret(access_token)
    if username:
        setting.github_username = username
    setting.github_auth_type = "oauth"
    setting.updated_at = datetime.datetime.utcnow()
    db.commit()

    return HTMLResponse(
        """<!DOCTYPE html><html><body style="background:#0f111a;color:#4ade80;font-family:system-ui;text-align:center;padding:50px;">
        <h2>✓ Successfully Connected to GitHub!</h2>
        <p style="color:#94a3b8;">Your GitHub account is linked. Closing this window...</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'oauth_success', provider: 'github' }, '*');
            setTimeout(() => window.close(), 1200);
          }
        </script>
        </body></html>"""
    )
