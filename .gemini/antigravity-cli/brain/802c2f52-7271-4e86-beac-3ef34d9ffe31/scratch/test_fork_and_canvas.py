import sys
import json
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal, ensure_db_schema
from backend.app.models import User, Dashboard, ChatSession, ChatMessage, LocalRepository, AgentPersona
from backend.app.config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD

def test_full_system():
    ensure_db_schema()
    client = TestClient(app)

    # 1. Login
    login_res = client.post("/api/auth/login", json={"email": DEFAULT_ADMIN_EMAIL, "password": DEFAULT_ADMIN_PASSWORD})
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("1. Authentication OK")

    # 2. Dashboards check
    dash_res = client.get("/api/dashboards", headers=headers)
    assert dash_res.status_code == 200
    dashboards = dash_res.json()
    assert len(dashboards) >= 1
    my_dash = dashboards[0]
    dash_id = my_dash["id"]
    print(f"2. Dashboards OK: Found '{my_dash['title']}' ({dash_id})")

    # 3. Zones update and retrieval
    zones_payload = [
        {"id": "zone-1", "title": "Commit & Churn Telemetry", "description": "Core git activity", "color": "#6366f1"},
        {"id": "zone-2", "title": "Performance Impact", "description": "Latency & throughput metrics", "color": "#10b981"}
    ]
    zone_put_res = client.put(f"/api/dashboards/{dash_id}/zones", json={"zones": zones_payload}, headers=headers)
    assert zone_put_res.status_code == 200, f"Failed to put zones: {zone_put_res.text}"

    get_dash_res = client.get(f"/api/dashboards/{dash_id}", headers=headers)
    assert get_dash_res.status_code == 200
    dash_detail = get_dash_res.json()
    assert "zones" in dash_detail
    assert len(dash_detail["zones"]) == 2
    assert dash_detail["zones"][0]["title"] == "Commit & Churn Telemetry"
    print("3. Visual Zones PUT/GET OK")

    # 4. Fluid hybrid layout update with continuous pixel_height and zone_id
    layout_payload = {
        "layouts": {
            "widget-1": {"x": 0, "y": 0, "w": 6, "h": 5, "pixel_height": 450, "zone_id": "zone-1"},
            "widget-2": {"x": 6, "y": 0, "w": 6, "h": 5, "pixel_height": 620, "zone_id": "zone-2"}
        }
    }
    layout_res = client.put(f"/api/dashboards/{dash_id}/layout", json=layout_payload, headers=headers)
    assert layout_res.status_code == 200
    print("4. Layout with pixel_height and zone_id OK")

    # 5. Check Agent Personas
    personas_res = client.get("/api/agents", headers=headers)
    assert personas_res.status_code == 200
    personas = personas_res.json()
    assert len(personas) >= 1
    print(f"5. Agent Personas OK: {len(personas)} personas loaded ({[p['id'] for p in personas]})")

    # 6. Check Local Repositories
    repos_res = client.get("/api/agents/repositories", headers=headers)
    assert repos_res.status_code == 200
    repos = repos_res.json()
    repo_names = [r["name"] for r in repos]
    print(f"6. Local Repositories OK: {repo_names}")

    # 7. Create parent Chat Session
    chat_create = client.post("/api/chat/sessions", json={"title": "Root PR Velocity Chat", "dashboard_id": dash_id}, headers=headers)
    assert chat_create.status_code == 200
    parent_sess = chat_create.json()
    parent_id = parent_sess["id"]
    print(f"7. Parent Session Created: {parent_id}")

    # Add messages directly to database for the parent session to simulate conversation
    db = SessionLocal()
    try:
        msg1 = ChatMessage(session_id=parent_id, role="user", content="Analyze author velocity across agor")
        msg2 = ChatMessage(session_id=parent_id, role="assistant", content="Here is the git commit velocity across top contributors.", thoughts="Queried duckdb table github_commits")
        msg3 = ChatMessage(session_id=parent_id, role="user", content="Now compare with lines added and lines deleted")
        msg4 = ChatMessage(session_id=parent_id, role="assistant", content="Here is the churn breakdown by author.")
        db.add_all([msg1, msg2, msg3, msg4])
        db.commit()
        db.refresh(msg2)
        fork_at_id = msg2.id
    finally:
        db.close()

    # 8. Fork Session at message #2 (fork point)
    fork_res = client.post(
        f"/api/chat/sessions/{parent_id}/fork",
        json={"message_id": fork_at_id, "title": "Branch: Author Deep Dive"},
        headers=headers
    )
    assert fork_res.status_code == 200, f"Fork failed: {fork_res.text}"
    child_sess = fork_res.json()
    child_id = child_sess["id"]
    assert child_sess["parent_session_id"] == parent_id
    assert child_sess["fork_message_id"] == fork_at_id
    assert child_sess["parent_title"] == "Root PR Velocity Chat"
    print(f"8. Session Forked OK: Child {child_id} linked to Parent {parent_id} at message #{fork_at_id}")

    # Verify messages in forked child session
    child_msgs_res = client.get(f"/api/chat/sessions/{child_id}/messages", headers=headers)
    assert child_msgs_res.status_code == 200
    child_msgs = child_msgs_res.json()
    # Should only contain messages up to fork_at_id (i.e. msg1 and msg2)
    assert len(child_msgs) == 2, f"Expected 2 cloned messages in child, got {len(child_msgs)}"
    assert child_msgs[0]["content"] == "Analyze author velocity across agor"
    assert child_msgs[1]["content"] == "Here is the git commit velocity across top contributors."
    assert child_msgs[1]["thoughts"] == "Queried duckdb table github_commits"
    print("9. Fork History Cloning & Context Isolation Verified: 2 messages correctly cloned, subsequent parent turns pruned.")

    # List sessions to ensure genealogy fields are present
    list_res = client.get("/api/chat/sessions", headers=headers)
    assert list_res.status_code == 200
    all_sess = list_res.json()
    child_summary = next((s for s in all_sess if s["id"] == child_id), None)
    assert child_summary is not None
    assert child_summary["parent_session_id"] == parent_id
    assert child_summary["parent_title"] == "Root PR Velocity Chat"
    assert child_summary["fork_message_id"] == fork_at_id
    print("10. Sessions List Genealogy Metadata Verified")

    print("\n>>> ALL 10 INTEGRATION VERIFICATION TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    test_full_system()
