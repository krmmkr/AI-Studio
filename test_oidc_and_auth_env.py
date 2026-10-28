import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.config import is_auth_enabled, DEFAULT_ADMIN_EMAIL
from backend.app.database import SessionLocal, engine, Base, ensure_db_schema
from backend.app.models import User
from backend.app.services.oidc_service import oidc_service

Base.metadata.create_all(bind=engine)
ensure_db_schema()

client = TestClient(app)


def test_auth_enabled_default_and_config():
    """Verify AUTH defaults to True and /api/auth/config reflects SSO enforcement."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("AUTH", None)
        assert is_auth_enabled() is True, "Default AUTH should be True"

    res = client.get("/api/auth/config")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    cfg = res.json()
    assert cfg["auth"] is True
    assert cfg["sso_enabled"] is True
    assert cfg["login_url"] == "/api/auth/oidc/login"
    print("✓ AUTH defaults to True and /api/auth/config reports SSO enabled")


def test_auth_true_enforces_authentication():
    """When AUTH=true, unauthenticated requests to protected endpoints return 401."""
    with patch.dict(os.environ, {"AUTH": "true"}):
        res = client.get("/api/auth/me")
        assert res.status_code == 401, f"Expected 401 when AUTH=true, got {res.status_code}"
    print("✓ When AUTH=true, unauthenticated requests return 401 (SSO required)")


def test_auth_false_bypasses_sso_for_dev_and_testing():
    """When AUTH=false, no SSO is required and requests resolve default dev admin."""
    with patch.dict(os.environ, {"AUTH": "false"}):
        assert is_auth_enabled() is False

        # 1. Config reports no SSO
        res_cfg = client.get("/api/auth/config")
        assert res_cfg.status_code == 200
        assert res_cfg.json()["auth"] is False
        assert res_cfg.json()["sso_enabled"] is False

        # 2. /api/auth/me succeeds without credentials and returns admin
        res_me = client.get("/api/auth/me")
        assert res_me.status_code == 200, f"Expected 200 when AUTH=false, got {res_me.status_code}: {res_me.text}"
        data = res_me.json()
        assert data["email"] == DEFAULT_ADMIN_EMAIL
        assert data["role"] == "admin"

        # 3. Protected endpoint also succeeds without credentials
        res_users = client.get("/api/auth/users")
        assert res_users.status_code == 200
        assert isinstance(res_users.json(), list)
    print("✓ When AUTH=false, SSO is disabled and dev admin is automatically resolved")


def test_oidc_login_and_pkce_generation():
    """Verify OIDC authorization URL generation with PKCE code_challenge and state."""
    # Test unconfigured guidance
    with patch.dict(os.environ, {"OIDC_CLIENT_ID": "", "OIDC_ISSUER_URL": ""}):
        res = client.get("/api/auth/oidc/login", follow_redirects=False)
        assert res.status_code == 200
        assert "OpenID Connect" in res.text

    # Test configured redirection
    with patch.dict(os.environ, {
        "OIDC_CLIENT_ID": "test-client-id-123",
        "OIDC_ISSUER_URL": "https://accounts.google.com",
        "OIDC_AUTHORIZATION_ENDPOINT": "https://accounts.google.com/o/oauth2/v2/auth",
        "OIDC_TOKEN_ENDPOINT": "https://oauth2.googleapis.com/token",
    }):
        res = client.get("/api/auth/oidc/login", follow_redirects=False)
        assert res.status_code == 307
        location = res.headers["location"]
        assert "https://accounts.google.com/o/oauth2/v2/auth" in location
        assert "client_id=test-client-id-123" in location
        assert "code_challenge=" in location
        assert "code_challenge_method=S256" in location
        assert "state=" in location
        assert "response_type=code" in location
    print("✓ /api/auth/oidc/login generates valid RFC 7636 PKCE authorization redirect")


def test_oidc_mock_flow_and_user_provisioning():
    """Verify end-to-end OIDC callback, user provisioning, and session token issuance."""
    # 1. Initiate mock login
    res_login = client.get("/api/auth/oidc/login?mock=true", follow_redirects=False)
    assert res_login.status_code == 307
    callback_url = res_login.headers["location"]
    assert "/api/auth/oidc/callback" in callback_url

    # 2. Extract code and state
    from urllib.parse import urlparse, parse_qs
    parsed = urlparse(callback_url)
    qs = parse_qs(parsed.query)
    code = qs["code"][0]
    state = qs["state"][0]

    # 3. Test callback GET (browser redirect flow)
    res_cb = client.get(f"/api/auth/oidc/callback?code={code}&state={state}")
    assert res_cb.status_code == 200
    assert "Authentication Successful" in res_cb.text
    assert "antigravity_token" in res_cb.text
    print("✓ Browser OIDC callback successfully renders session establishment payload")

    # 4. Test callback POST (API token exchange flow)
    res_post = client.post("/api/auth/oidc/token", json={"code": code, "state": state})
    assert res_post.status_code == 200
    token_data = res_post.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"
    assert token_data["user"]["email"] == "sso_user@antigravity.io"
    print("✓ POST /api/auth/oidc/token returns access_token and user claims")

    # 5. Verify the token authenticates against /api/auth/me
    token = token_data["access_token"]
    res_me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res_me.status_code == 200
    assert res_me.json()["email"] == "sso_user@antigravity.io"
    print("✓ Generated OIDC session token authenticates successfully against /api/auth/me")


def test_oidc_admin_email_role_elevation():
    """Verify user matching OIDC_ADMIN_EMAILS is provisioned with role 'admin'."""
    db = SessionLocal()
    try:
        user_info = {
            "email": "corporate_lead@company.com",
            "name": "Corporate Lead",
            "sub": "corp-lead-001",
            "roles": ["member"],
        }
        with patch.dict(os.environ, {"OIDC_ADMIN_EMAILS": "corporate_lead@company.com"}):
            user = oidc_service.find_or_provision_user(user_info, db)
            assert user.role == "admin", f"Expected admin role, got {user.role}"
        print("✓ OIDC_ADMIN_EMAILS assigns admin role upon SSO provisioning")
    finally:
        db.close()


def test_password_login_compatibility():
    """Verify local password login /api/auth/login still functions properly."""
    res = client.post("/api/auth/login", json={
        "email": DEFAULT_ADMIN_EMAIL,
        "password": "antigravity123",
    })
    assert res.status_code == 200, f"Password login failed: {res.text}"
    assert "access_token" in res.json()
    print("✓ Existing password login (/api/auth/login) operates correctly")


def test_system_branding_endpoints():
    """Verify system branding read and admin-only update functionality."""
    # 1. Public read
    res = client.get("/api/system/branding")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert "app_name" in data
    assert "logo_url" in data
    print("✓ Public GET /api/system/branding returned current branding")

    # 2. Unauthenticated PUT must be rejected (401 when AUTH=true)
    with patch.dict(os.environ, {"AUTH": "true"}):
        res_unauth = client.put("/api/system/branding", json={"app_name": "Hacked Brand"})
        assert res_unauth.status_code == 401, f"Expected 401 for unauth update, got {res_unauth.status_code}"
        print("✓ Unauthenticated PUT /api/system/branding rejected with 401")

    # 3. Non-admin user PUT must be rejected with 403 Forbidden
    db = SessionLocal()
    member_user = db.query(User).filter(User.email == "regular_member@company.com").first()
    if not member_user:
        from backend.app.auth import hash_password
        member_user = User(
            email="regular_member@company.com",
            hashed_password=hash_password("memberpass123"),
            role="member"
        )
        db.add(member_user)
        db.commit()
        db.refresh(member_user)
    db.close()

    from backend.app.auth import create_access_token
    member_token = create_access_token({"sub": str(member_user.id), "email": member_user.email, "role": "member"})
    res_forbidden = client.put(
        "/api/system/branding",
        json={"app_name": "Disallowed Brand"},
        headers={"Authorization": f"Bearer {member_token}"}
    )
    assert res_forbidden.status_code == 403, f"Expected 403 for non-admin, got {res_forbidden.status_code}"
    print("✓ Member (non-admin) PUT /api/system/branding blocked with 403 Forbidden")

    # 4. Admin user PUT succeeds
    db = SessionLocal()
    admin_user = db.query(User).filter(User.email == DEFAULT_ADMIN_EMAIL).first()
    db.close()
    admin_token = create_access_token({"sub": str(admin_user.id), "email": DEFAULT_ADMIN_EMAIL, "role": "admin"})
    res_admin = client.put(
        "/api/system/branding",
        json={"app_name": "Acme Enterprise AI", "logo_url": "https://example.com/acme-logo.svg"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res_admin.status_code == 200, f"Expected 200 for admin update, got {res_admin.status_code}: {res_admin.text}"
    updated = res_admin.json()
    assert updated["app_name"] == "Acme Enterprise AI"
    assert updated["logo_url"] == "https://example.com/acme-logo.svg"

    # 5. Verify subsequent GET reflects new branding
    res_get = client.get("/api/system/branding")
    assert res_get.status_code == 200
    assert res_get.json()["app_name"] == "Acme Enterprise AI"
    assert res_get.json()["logo_url"] == "https://example.com/acme-logo.svg"
    print("✓ Admin successfully updated brand name & logo; verified persisted state")

    # 6. Reset branding back to default
    res_reset = client.put(
        "/api/system/branding",
        json={"app_name": "AI Studio", "logo_url": ""},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res_reset.status_code == 200
    assert res_reset.json()["app_name"] == "AI Studio"
    assert res_reset.json()["logo_url"] == ""
    print("✓ Reset system branding back to default")


if __name__ == "__main__":
    print("\n=======================================================")
    print("  Running OIDC & AUTH Environment Variable Test Suite  ")
    print("=======================================================\n")
    test_auth_enabled_default_and_config()
    test_auth_true_enforces_authentication()
    test_auth_false_bypasses_sso_for_dev_and_testing()
    test_oidc_login_and_pkce_generation()
    test_oidc_mock_flow_and_user_provisioning()
    test_oidc_admin_email_role_elevation()
    test_password_login_compatibility()
    test_system_branding_endpoints()
    print("\n✓ ALL OIDC, AUTH, AND BRANDING TESTS PASSED PERFECTLY!\n")
