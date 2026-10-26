"""
Verification suite for Localized Pin Popup Chat & Unified Chat Session Architecture.
Verifies:
1. Pin creation automatically provisions a localized ChatSession with scope='pin'
2. Pin chat messages are stored in the unified chat_messages table
3. GET /api/dashboards/{dash_id}/comments/{comment_id}/messages returns pin Q&A history
4. Calling SSE stream on pin session produces localized response without polluting general chat list
5. GET /api/chat/sessions excludes pin sessions from the main user sidebar by default
6. Pin deletion cleanly cascades/cleans up associated pin chat session
"""

import os
import json
import asyncio
from fastapi.testclient import TestClient

# Use isolated test database
os.environ["DATABASE_URL"] = "sqlite:////tmp/test_pin_chat_upgrades.db"
os.environ["SEED_MOCK_DATA"] = "false"

from backend.app.main import app
from backend.app.database import engine, Base, SessionLocal, ensure_db_schema
from backend.app.models import User, Dashboard, DashboardWidget, DashboardComment, ChatSession, ChatMessage
from backend.app.auth import hash_password, create_access_token

Base.metadata.create_all(bind=engine)
ensure_db_schema()

client = TestClient(app)

def test_pin_chat_pipeline():
    print("\n--- Running Localized Pin Popup Chat & Unified Table Suite ---")
    
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "test_pin_user@example.com").first()
        if not user:
            user = User(
                email="test_pin_user@example.com",
                hashed_password=hash_password("password123"),
                role="member"
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        
        user_id = user.id
        user_email = user.email

        # Create test dashboard
        dash = db.query(Dashboard).filter(Dashboard.id == "dash-pin-test-01").first()
        if not dash:
            dash = Dashboard(
                id="dash-pin-test-01",
                user_id=user_id,
                title="Pin Chat Architecture Test Dashboard",
                is_public=False
            )
            db.add(dash)
            db.commit()
            db.refresh(dash)

        # Create test widget
        w = db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == "dash-pin-test-01", DashboardWidget.widget_id == "w-pr-velocity").first()
        if not w:
            w = DashboardWidget(
                dashboard_id="dash-pin-test-01",
                widget_id="w-pr-velocity",
                title="PR Velocity Analysis",
                widget_type="echarts",
                grid_json=json.dumps({"x": 0, "y": 0, "w": 6, "h": 4}),
                spec_json=json.dumps({"series": [{"name": "PRs", "data": [10, 20, 30]}]})
            )
            db.add(w)
            db.commit()

    token = create_access_token({"sub": str(user_id), "email": user_email, "role": "member"})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Create a spatial comment pin on the widget
    res_comment = client.post(
        "/api/dashboards/dash-pin-test-01/comments",
        json={
            "widget_id": "w-pr-velocity",
            "content": "Why did PR velocity drop on day 3?",
            "pos_x": 42,
            "pos_y": 68
        },
        headers=headers
    )
    assert res_comment.status_code == 200, f"Failed to create comment: {res_comment.text}"
    comment_data = res_comment.json()
    comment_id = comment_data["id"]
    chat_session_id = comment_data["chat_session_id"]
    assert chat_session_id == f"pin-dash-pin-test-01-{comment_id}"
    print(f"✓ Pin #{comment_id} created with dedicated ChatSession ID: {chat_session_id}")

    # Verify database session state
    with SessionLocal() as db:
        session_row = db.query(ChatSession).filter(ChatSession.id == chat_session_id).first()
        assert session_row is not None, "ChatSession row was not created"
        assert session_row.scope == "pin"
        assert session_row.pin_id == comment_id
        assert session_row.widget_id == "w-pr-velocity"
        assert session_row.dashboard_id == "dash-pin-test-01"
    print("✓ ChatSession verified in database: scope='pin', pin_id and widget_id correctly linked")

    # 2. Test Stream Chat inside this pin's localized session
    res_stream = client.post(
        f"/api/chat/sessions/{chat_session_id}/stream",
        json={
            "message": "Can you analyze the velocity trend on day 3?",
            "dashboard_id": "dash-pin-test-01",
            "scope": "pin",
            "pin_id": comment_id,
            "widget_id": "w-pr-velocity",
            "agent_id": "github-agent"
        },
        headers=headers
    )
    assert res_stream.status_code == 200, f"Stream failed: {res_stream.text}"
    stream_body = res_stream.text
    assert "data: " in stream_body
    print("✓ Localized Pin SSE Chat stream executed successfully")

    # 2b. Test Pin Styling adjustment emits canvas_action and updates widget
    res_style = client.post(
        f"/api/chat/sessions/{chat_session_id}/stream",
        json={
            "message": "Make title color emerald and update theme",
            "dashboard_id": "dash-pin-test-01",
            "scope": "pin",
            "pin_id": comment_id,
            "widget_id": "w-pr-velocity",
            "agent_id": "github-agent"
        },
        headers=headers
    )
    assert res_style.status_code == 200
    assert "canvas_action" in res_style.text
    print("✓ Localized Pin Canvas Action emitted and verified")

    # 3. Verify messages are stored in the unified chat_messages table
    with SessionLocal() as db:
        msgs = db.query(ChatMessage).filter(ChatMessage.session_id == chat_session_id).all()
        assert len(msgs) >= 2, f"Expected user + assistant messages in chat_messages, got {len(msgs)}"
        user_m = next((m for m in msgs if m.role == "user"), None)
        assert user_m is not None
        assert "velocity trend" in user_m.content
    print(f"✓ Unified chat_messages table verified ({len(msgs)} messages stored under pin session)")

    # 4. Verify GET /api/dashboards/{id}/comments/{id}/messages endpoint
    res_msgs = client.get(
        f"/api/dashboards/dash-pin-test-01/comments/{comment_id}/messages",
        headers=headers
    )
    assert res_msgs.status_code == 200, f"Failed to get pin messages: {res_msgs.text}"
    retrieved_msgs = res_msgs.json()
    assert len(retrieved_msgs) >= 2
    assert retrieved_msgs[0]["role"] == "user"
    print(f"✓ GET comment messages endpoint returned {len(retrieved_msgs)} messages for Pin #{comment_id}")

    # 5. Verify Main Sidebar Isolation: Pin sessions should NOT appear in default /api/chat/sessions
    # First create a regular global/dashboard exploration session
    res_reg_session = client.post(
        "/api/chat/sessions",
        json={"title": "Primary Canvas Exploration", "dashboard_id": "dash-pin-test-01", "scope": "dashboard"},
        headers=headers
    )
    assert res_reg_session.status_code == 200

    res_all_sessions = client.get("/api/chat/sessions", headers=headers)
    assert res_all_sessions.status_code == 200
    all_sessions = res_all_sessions.json()
    
    # The pin session must NOT be in the default main sidebar list
    pin_in_main_list = any(s["id"] == chat_session_id for s in all_sessions)
    assert not pin_in_main_list, "Pin session leaked into main sidebar chat session listing!"
    print("✓ Main Chat Sidebar verified: Localized pin popup sessions are cleanly isolated from the main sidebar")

    # Querying with scope="pin" specifically should return it
    res_pin_sessions = client.get("/api/chat/sessions?scope=pin", headers=headers)
    assert res_pin_sessions.status_code == 200
    pin_sessions = res_pin_sessions.json()
    assert any(s["id"] == chat_session_id for s in pin_sessions)
    print("✓ Scoped session filtering verified: ?scope=pin cleanly returns pin sessions when requested")

    # 6. Delete pin and verify cascading cleanup
    res_del = client.delete(f"/api/dashboards/dash-pin-test-01/comments/{comment_id}", headers=headers)
    assert res_del.status_code == 200
    
    with SessionLocal() as db:
        remaining_comment = db.query(DashboardComment).filter(DashboardComment.id == comment_id).first()
        assert remaining_comment is None
        remaining_session = db.query(ChatSession).filter(ChatSession.id == chat_session_id).first()
        assert remaining_session is None
    print("✓ Pin deletion and associated ChatSession cleanup verified")

    print("\nALL PIN POPUP CHAT & UNIFIED STORAGE TESTS PASSED 100%! 🚀")

if __name__ == "__main__":
    test_pin_chat_pipeline()
    if os.path.exists("/tmp/test_pin_chat_upgrades.db"):
        os.remove("/tmp/test_pin_chat_upgrades.db")
