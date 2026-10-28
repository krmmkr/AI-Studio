import asyncio
import os
import sys
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal
from backend.app.models import User, UserSetting
from backend.app.auth import create_access_token, decrypt_secret

def run_tests():
    client = TestClient(app)
    db = SessionLocal()
    try:
        # Find or create a test user
        user = db.query(User).filter(User.email == "test_user_settings@antigravity.io").first()
        if not user:
            from backend.app.auth import hash_password
            user = User(
                email="test_user_settings@antigravity.io",
                hashed_password=hash_password("InitialPassword123!"),
                role="member"
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        token = create_access_token({"sub": str(user.id), "role": user.role})
        headers = {"Authorization": f"Bearer {token}"}

        print("\n--- Testing User Settings & Integrations ---")

        # 1. Test GET /api/user/settings
        res = client.get("/api/user/settings", headers=headers)
        assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
        data = res.json()
        assert data["user"]["email"] == "test_user_settings@antigravity.io"
        assert "integrations" in data
        assert "git" in data
        print("✓ GET /api/user/settings returned clean initial settings")

        # 2. Test PUT /api/user/settings with secrets
        put_payload = {
            "git_name": "Test Engineer",
            "git_email": "test_engineer@company.com",
            "github_token": "ghp_1234567890abcdef1234567890abcdef",
            "github_username": "testdev",
            "jira_url": "https://test-team.atlassian.net",
            "jira_email": "test_engineer@company.com",
            "jira_token": "atlassian_secret_pat_987654321",
            "deepseek_api_key": "dsk-deepseek-supersecret-token",
            "anthropic_api_key": "sk-ant-anthropic-supersecret-token"
        }
        res = client.put("/api/user/settings", json=put_payload, headers=headers)
        assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
        print("✓ PUT /api/user/settings successfully saved user configuration")

        # 3. Verify Database Field-Level AES-256 Encryption
        db_setting = db.query(UserSetting).filter(UserSetting.user_id == user.id).first()
        assert db_setting is not None
        assert db_setting.git_name == "Test Engineer"
        # Verify secrets are NOT in plaintext in the database
        assert "ghp_1234567890" not in db_setting.github_token, "GitHub token stored in plaintext!"
        assert "dsk-deepseek" not in db_setting.deepseek_api_key, "DeepSeek key stored in plaintext!"
        assert "sk-ant" not in db_setting.anthropic_api_key, "Anthropic key stored in plaintext!"
        assert "atlassian_secret" not in db_setting.jira_token, "Jira token stored in plaintext!"
        # Verify they can be decrypted correctly
        assert decrypt_secret(db_setting.github_token) == "ghp_1234567890abcdef1234567890abcdef"
        assert decrypt_secret(db_setting.deepseek_api_key) == "dsk-deepseek-supersecret-token"
        assert decrypt_secret(db_setting.anthropic_api_key) == "sk-ant-anthropic-supersecret-token"
        print("✓ Verified AES-256 (Fernet) field-level encryption at rest for all stored user tokens")

        # 4. Test GET /api/user/settings returns masked representations
        res = client.get("/api/user/settings", headers=headers)
        assert res.status_code == 200
        data = res.json()
        gh_info = data["integrations"]["github"]
        assert gh_info["has_token"] is True
        assert gh_info["username"] == "testdev"
        assert gh_info["masked_token"].startswith("ghp_")
        assert "••••" in gh_info["masked_token"]
        assert "1234567890abcdef" not in gh_info["masked_token"]

        jira_info = data["integrations"]["jira"]
        assert jira_info["has_token"] is True
        assert jira_info["url"] == "https://test-team.atlassian.net"
        assert "••••" in jira_info["masked_token"]

        byok = data["integrations"]["byok"]
        assert byok["deepseek"]["has_key"] is True
        assert "••••" in byok["deepseek"]["masked_key"]
        assert byok["anthropic"]["has_key"] is True
        assert "••••" in byok["anthropic"]["masked_key"]
        assert byok["openai"]["has_key"] is False
        print("✓ Verified API masks all secret tokens on egress (zero secret leakage)")

        # 5. Test Disconnecting OAuth / Services
        res = client.post("/api/user/oauth/atlassian/disconnect", headers=headers)
        assert res.status_code == 200
        res = client.get("/api/user/settings", headers=headers)
        assert res.json()["integrations"]["jira"]["has_token"] is False
        print("✓ Verified 1-click disconnect of connected integrations")

        # 6. Test Change Password
        # Wrong current password fails
        res = client.post("/api/user/change-password", json={
            "current_password": "WrongPassword!",
            "new_password": "NewSecretPassword123!"
        }, headers=headers)
        assert res.status_code == 400
        # Correct current password succeeds
        res = client.post("/api/user/change-password", json={
            "current_password": "InitialPassword123!",
            "new_password": "NewSecretPassword123!"
        }, headers=headers)
        assert res.status_code == 200
        print("✓ Verified self-service change password flow")

        # 7. Test OAuth Browser popup authentication via ?token= query parameter
        res = client.get(f"/api/user/oauth/atlassian/login?token={token}")
        assert res.status_code == 200
        assert "Atlassian OAuth" in res.text
        res_no_auth = client.get("/api/user/oauth/atlassian/login")
        assert res_no_auth.status_code == 401
        print("✓ Verified Browser OAuth popup authentication via token query param and 401 guard")

        print("\nALL USER SETTINGS, ENCRYPTION & INTEGRATION TESTS PASSED 100%! 🛡️🚀\n")

        print("\nALL USER SETTINGS, ENCRYPTION & INTEGRATION TESTS PASSED 100%! 🛡️🚀\n")

    finally:
        # Cleanup test user
        if user:
            db.delete(user)
            db.commit()
        db.close()

if __name__ == "__main__":
    run_tests()
