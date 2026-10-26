import sys
import json
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.auth import create_access_token, encrypt_secret, decrypt_secret
from backend.app.database import SessionLocal
from backend.app.models import User, Dashboard, DashboardWidget, DashboardComment, MCPConfig
from backend.app.services.duckdb_service import duckdb_service

client = TestClient(app)

def test_production_security_and_stability():
    print("\n--- Running Production Fixes Verification Suite ---")

    # 1. Test MCP Auth Header Encryption at Rest
    plain_token = "ghp_secret_personal_access_token_12345"
    enc = encrypt_secret(plain_token)
    assert enc != plain_token, "Encryption failed: token remained in plaintext"
    dec = decrypt_secret(enc)
    assert dec == plain_token, "Decryption failed to retrieve original plaintext"
    print("✓ MCP Credential Field-Level Encryption & Decryption passed")

    # 2. Test SSRF Protection on /api/mcp/test
    # 2a. Unauthenticated access must return 401
    res_unauth = client.post("/api/mcp/test", json={"url": "http://example.com/sse", "transport": "sse"})
    assert res_unauth.status_code == 401, f"Expected 401 for unauth /api/mcp/test, got {res_unauth.status_code}"
    print("✓ Unauthenticated MCP test blocked (401)")

    # Login admin
    login_res = client.post("/api/auth/login", json={"email": "admin@antigravity.io", "password": "antigravity123"})
    admin_token = login_res.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 2b. SSRF attempts to cloud metadata must be blocked
    res_ssrf = client.post(
        "/api/mcp/test",
        json={"url": "http://169.254.169.254/latest/meta-data/", "transport": "http"},
        headers=admin_headers
    )
    assert res_ssrf.status_code == 200
    assert res_ssrf.json()["success"] is False
    assert "metadata" in res_ssrf.json()["message"].lower() or "blocked" in res_ssrf.json()["message"].lower()
    print("✓ Cloud Metadata SSRF blocked")

    # 3. Test IDOR & Authorization Checks on Comments & Widgets
    with SessionLocal() as db:
        admin_user = db.query(User).filter(User.email == "admin@antigravity.io").first()
        # Create non-admin test user
        user_b = db.query(User).filter(User.email == "user_b@antigravity.io").first()
        if not user_b:
            user_b = User(email="user_b@antigravity.io", hashed_password="pw", role="member")
            db.add(user_b)
            db.commit()
            db.refresh(user_b)

        # Create private dashboard owned by admin
        private_dash = Dashboard(
            id="dash-private-sec-test",
            user_id=admin_user.id,
            title="Admin Private Dashboard",
            is_public=False
        )
        db.merge(private_dash)
        
        # Add widget
        w = DashboardWidget(
            dashboard_id="dash-private-sec-test",
            widget_id="w-secret",
            title="Secret Admin Widget",
            grid_json=json.dumps({"x": 0, "y": 0, "w": 6, "h": 4}),
            spec_json=json.dumps({"series": []})
        )
        db.merge(w)

        # Add comment
        c = DashboardComment(
            id=9999,
            dashboard_id="dash-private-sec-test",
            widget_id="w-secret",
            user_email=admin_user.email,
            content="Sensitive team remark",
            replies_json="[]"
        )
        db.merge(c)
        db.commit()
        user_b_id = user_b.id
        user_b_email = user_b.email

    token_b = create_access_token({"sub": str(user_b_id), "email": user_b_email, "role": "member"})
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # User B should NOT be able to view comments on Admin's private dashboard
    res_idor_get = client.get("/api/dashboards/dash-private-sec-test/comments", headers=headers_b)
    assert res_idor_get.status_code == 404, f"Expected 404 IDOR block, got {res_idor_get.status_code}"

    # User B should NOT be able to post comment on Admin's private dashboard
    res_idor_post = client.post(
        "/api/dashboards/dash-private-sec-test/comments",
        json={"content": "Malicious comment", "pos_x": 10, "pos_y": 10},
        headers=headers_b
    )
    assert res_idor_post.status_code == 404, f"Expected 404 IDOR block, got {res_idor_post.status_code}"

    # User B should NOT be able to delete Admin's widget
    res_idor_del_w = client.delete("/api/dashboards/dash-private-sec-test/widgets/w-secret", headers=headers_b)
    assert res_idor_del_w.status_code == 403, f"Expected 403 IDOR block, got {res_idor_del_w.status_code}"

    # User B should NOT be able to delete Admin's comment
    res_idor_del_c = client.delete("/api/dashboards/dash-private-sec-test/comments/9999", headers=headers_b)
    assert res_idor_del_c.status_code == 403, f"Expected 403 IDOR block, got {res_idor_del_c.status_code}"
    print("✓ IDOR Protection & Authorization boundaries verified")

    # 4. Test DuckDB SQL Guard Improvements
    # 4a. Semicolons inside string literals should NOT trigger false positive
    q_semicolon_str = "SELECT 'message;with;semicolons' AS msg WHERE 'test;str' LIKE '%;%';"
    res_q1 = client.post("/api/duckdb/query", json={"sql": q_semicolon_str}, headers=admin_headers)
    assert res_q1.status_code == 200, f"Expected 200 for semicolon in literal, got {res_q1.text}"

    # 4b. Disallowed keyword inside string literal should NOT trigger false positive
    q_keyword_str = "SELECT 'update session cache' AS msg WHERE 'update session cache' LIKE '%update%';"
    res_q2 = client.post("/api/duckdb/query", json={"sql": q_keyword_str}, headers=admin_headers)
    assert res_q2.status_code == 200, f"Expected 200 for 'update' in literal, got {res_q2.text}"

    # 4c. True multi-statement attacks must be blocked
    q_attack1 = "SELECT 1; DROP TABLE users;"
    res_q3 = client.post("/api/duckdb/query", json={"sql": q_attack1}, headers=admin_headers)
    assert res_q3.status_code == 400
    assert "multi-statement" in res_q3.json()["detail"].lower()

    # 4d. PRAGMA attacks must be blocked
    q_attack2 = "SELECT * FROM pragma_database_list();"
    res_q4 = client.post("/api/duckdb/query", json={"sql": q_attack2}, headers=admin_headers)
    assert res_q4.status_code == 400
    assert "pragma" in res_q4.json()["detail"].lower()
    print("✓ DuckDB SQL Guard (string-literal aware + attack prevention) passed")

    # 5. Test Dataset Deletion Support
    from backend.app.services.duckdb_service import duckdb_service
    duckdb_service.materialize_dataset("test_to_delete", [{"id": 1, "name": "sample"}])
    res_del_ds = client.delete("/api/duckdb/datasets/test_to_delete", headers=headers_b)
    assert res_del_ds.status_code == 200, f"Expected 200 for dropping user dataset, got {res_del_ds.status_code}"
    print("✓ User Dataset deletion verified")

    # Clean up test records
    with SessionLocal() as db:
        db.query(DashboardComment).filter(DashboardComment.dashboard_id == "dash-private-sec-test").delete()
        db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == "dash-private-sec-test").delete()
        db.query(Dashboard).filter(Dashboard.id == "dash-private-sec-test").delete()
        db.commit()

    print("\nALL PRODUCTION FIXES & STABILITY UPGRADES VERIFIED 100%! 🛡️🚀")

if __name__ == "__main__":
    test_production_security_and_stability()
