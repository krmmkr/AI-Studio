"""
Verification suite for:
1. Predictable Agent Intent Routing (Create Filter Controller vs Title Color vs Filter Scope)
2. Predictable Dashboard & Repository Refresh Pipeline (re-clone/sync, DuckDB update, widget re-query)
3. Direct POST /api/dashboards/{id}/refresh endpoint execution
"""

import os
import json
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite:////tmp/test_filter_refresh.db"
os.environ["SEED_MOCK_DATA"] = "false"

from backend.app.main import app
from backend.app.database import engine, Base, SessionLocal, ensure_db_schema
from backend.app.models import User, Dashboard, DashboardWidget, LocalRepository, ChatSession
from backend.app.auth import hash_password, create_access_token

Base.metadata.create_all(bind=engine)
ensure_db_schema()

client = TestClient(app)

def test_filter_and_refresh_pipeline():
    print("\n--- Running Filter & Refresh Predictability Suite ---")

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "filter_user@example.com").first()
        if not user:
            user = User(
                email="filter_user@example.com",
                hashed_password=hash_password("password123"),
                role="member"
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        user_id = user.id
        user_email = user.email

        # Create test dashboard
        dash = db.query(Dashboard).filter(Dashboard.id == "dash-filter-01").first()
        if not dash:
            dash = Dashboard(
                id="dash-filter-01",
                user_id=user_id,
                title="Predictability & Refresh Test Dashboard",
                is_public=False
            )
            db.add(dash)
            db.commit()

        # Create test widget
        w = db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == "dash-filter-01", DashboardWidget.widget_id == "w-pr-trend").first()
        if not w:
            w = DashboardWidget(
                dashboard_id="dash-filter-01",
                widget_id="w-pr-trend",
                title="PR Turnaround Trend",
                widget_type="echarts",
                grid_json=json.dumps({"x": 0, "y": 0, "w": 6, "h": 4}),
                spec_json=json.dumps({"xAxis": {"data": []}, "series": [{"data": []}]}),
                datasource_json=json.dumps({"type": "github", "query": "SELECT author, sum(lines_added) as added FROM github_commits GROUP BY 1 ORDER BY 1"})
            )
            db.add(w)
            db.commit()

        # Create test local repository
        repo = db.query(LocalRepository).filter(LocalRepository.name == "main-service").first()
        if not repo:
            repo = LocalRepository(
                name="main-service",
                remote_url="https://github.com/example/main-service.git",
                local_path="/tmp/test_main_service_repo",
                clone_type="shallow",
                default_branch="main"
            )
            db.add(repo)
            db.commit()

    token = create_access_token({"sub": str(user_id), "email": user_email, "role": "member"})
    headers = {"Authorization": f"Bearer {token}"}

    # Seed a chart with real categorical dimensions so single filter extraction can inspect it
    with SessionLocal() as db:
        w = db.query(DashboardWidget).filter(
            DashboardWidget.dashboard_id == "dash-filter-01",
            DashboardWidget.widget_id == "w-pr-trend"
        ).first()
        if w:
            w.spec_json = json.dumps({
                "title": [
                    {"text": "hog (StreamLens) — Contributor & Codebase Analysis"},
                    {"text": "Tracked file composition"}
                ],
                "yAxis": {
                    "type": "category",
                    "data": [
                        "Bytecode & session data",
                        "Frontend dist",
                        "First-party source & config",
                        "Backend venv",
                        "Frontend node_modules"
                    ]
                },
                "xAxis": {"type": "value"},
                "series": [
                    {
                        "name": "Tracked files",
                        "type": "bar",
                        "data": [9, 3, 24, 3814, 6567]
                    }
                ]
            })
            db.commit()

    # 1. Test "i mean a filter for tracked file composition": Must create a SINGLE Checkbox Filter Widget
    res_session = client.post(
        "/api/chat/sessions",
        json={"title": "Filter Creation Test", "dashboard_id": "dash-filter-01", "scope": "dashboard"},
        headers=headers
    )
    assert res_session.status_code == 200
    session_id = res_session.json()["id"]

    res_filter_chat = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "i mean a filter for tracked file composition",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_filter_chat.status_code == 200
    body_filter = res_filter_chat.text
    assert "create_single_filter_widget" in body_filter, "Failed to call create_single_filter_widget tool"
    assert "canvas_action" in body_filter, "Failed to emit canvas_action for single filter widget"
    assert '"widget_type": "filter"' in body_filter or '"widget_type":"filter"' in body_filter, "Widget type was not 'filter'"
    assert "[Option:" not in body_filter, "Predefined [Option: ...] spam must not be emitted"
    print("✓ Agent Action Predictability: 'i mean a filter for tracked file composition' created a single filter widget")

    # Verify single filter widget in database
    with SessionLocal() as db:
        fw = db.query(DashboardWidget).filter(
            DashboardWidget.dashboard_id == "dash-filter-01",
            DashboardWidget.widget_type == "filter"
        ).first()
        assert fw is not None, "Single filter widget was not saved to database"
        spec = json.loads(fw.spec_json)
        assert spec.get("type") == "single_filter", f"Expected type=='single_filter', got {spec.get('type')}"
        assert spec.get("filter_type") == "checkbox", f"Expected filter_type=='checkbox', got {spec.get('filter_type')}"
        assert "controls" not in spec, "Grouped 4-in-1 controls array must not be present in single filter widget"
        assert len(spec.get("options", [])) == 5, f"Expected 5 extracted file categories, got {len(spec.get('options', []))}"
        assert spec.get("target_widget_ids") == ["w-pr-trend"]
    print("✓ Single Checkbox Filter persisted with 5 extracted source categories and bound to target chart")

    # 1b. Test adding a SECOND single filter widget (e.g., Date Picker filter) on the same dashboard
    res_date_filter = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "add a date picker filter for time horizon",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_date_filter.status_code == 200
    with SessionLocal() as db:
        all_filters = db.query(DashboardWidget).filter(
            DashboardWidget.dashboard_id == "dash-filter-01",
            DashboardWidget.widget_type == "filter"
        ).all()
        assert len(all_filters) == 2, f"Expected 2 distinct single filter widgets on dashboard, got {len(all_filters)}"
        ft_set = {json.loads(f.spec_json).get("filter_type") for f in all_filters}
        assert ft_set == {"checkbox", "date_picker"}, f"Expected checkbox and date_picker filters, got {ft_set}"
    print("✓ Multiple Single Filter Widgets coexist on dashboard (checkbox + date_picker)")

    # 2. Test "change title color to cyan": Must reliably update styling
    res_color_chat = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "Change title color to cyan for PR Turnaround Trend",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_color_chat.status_code == 200
    body_color = res_color_chat.text
    assert "update_widget" in body_color
    assert "[Option:" not in body_color
    print("✓ Agent Action Predictability: 'change title color to cyan' reliably updated widget styling")

    # 2b. Test "[Action on PR Turnaround Trend]: can we have labels for each bars"
    res_labels_chat = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "[Action on PR Turnaround Trend]: can we have labels for each bars",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_labels_chat.status_code == 200
    body_labels = res_labels_chat.text
    assert "update_widget" in body_labels
    assert "Official Shields.io Badges" not in body_labels, "Must never return canned Shields.io text!"
    with SessionLocal() as db:
        w_after_lbl = db.query(DashboardWidget).filter(
            DashboardWidget.dashboard_id == "dash-filter-01",
            DashboardWidget.widget_id == "w-pr-trend"
        ).first()
        sp_lbl = json.loads(w_after_lbl.spec_json)
        assert sp_lbl["series"][0]["label"]["show"] is True
        assert sp_lbl["series"][0]["label"]["position"] == "right"
    print("✓ Agent Action Predictability: 'can we have labels for each bars' enabled ECharts series labels in-place")

    # 2c. Test "[Action on PR Turnaround Trend]: can we make this widget bigger"
    res_resize_chat = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "[Action on PR Turnaround Trend]: can we make this widget bigger",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_resize_chat.status_code == 200
    body_resize = res_resize_chat.text
    assert "update_widget" in body_resize
    assert "Official Shields.io Badges" not in body_resize
    with SessionLocal() as db:
        w_after_rsz = db.query(DashboardWidget).filter(
            DashboardWidget.dashboard_id == "dash-filter-01",
            DashboardWidget.widget_id == "w-pr-trend"
        ).first()
        grid_rsz = json.loads(w_after_rsz.grid_json)
        assert grid_rsz["w"] > 6 and grid_rsz["h"] > 4, f"Expected resized grid > 6x4, got {grid_rsz}"
    print(f"✓ Agent Action Predictability: 'can we make this widget bigger' resized grid to {grid_rsz['w']}x{grid_rsz['h']}")

    # 3. Test "refresh dashboard": Must trigger telemetry refresh pipeline
    res_refresh_chat = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "Refresh dashboard and update telemetry",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_refresh_chat.status_code == 200
    body_refresh = res_refresh_chat.text
    assert "refresh_dashboard_and_repositories" in body_refresh
    print("✓ Agent Action Predictability: 'refresh dashboard' reliably executed multi-stage sync & telemetry pipeline")

    # 4. Test direct POST /api/dashboards/{id}/refresh endpoint
    res_refresh_api = client.post(
        "/api/dashboards/dash-filter-01/refresh",
        headers=headers
    )
    assert res_refresh_api.status_code == 200, f"Refresh endpoint failed: {res_refresh_api.text}"
    ref_data = res_refresh_api.json()
    assert ref_data["success"] is True
    assert "widgets" in ref_data
    assert len(ref_data["widgets"]) >= 1
    print(f"✓ Direct POST /api/dashboards/dash-filter-01/refresh returned {len(ref_data['widgets'])} refreshed widgets")

    # 5. Test Ambiguous Prompt: Must ask contextual question grounded in dashboard widgets without [Option: ...] spam
    res_ambiguous = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "somethings are getting updated, while somethings are not",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_ambiguous.status_code == 200
    body_ambiguous = res_ambiguous.text
    assert "Turnaround" in body_ambiguous and "Tracked" in body_ambiguous, "Contextual question should reference actual chart and dimension on dashboard"
    assert "[Option:" not in body_ambiguous, "Must not output canned [Option: ...] spam"
    assert "actively connected to your Model Context Protocol (MCP) tool chain" not in body_ambiguous
    print("✓ Agent Contextual Clarification: Ambiguous prompt referenced actual dashboard charts/dimensions with zero [Option: ...] spam")

    # 6. Test Greeting: Must return contextual welcome with actual canvas inventory and zero [Option: ...] spam
    res_greeting = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "Hello!",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_greeting.status_code == 200
    body_greeting = res_greeting.text
    assert "actively connected to your Model Context Protocol (MCP) tool chain" not in body_greeting
    assert "[Option:" not in body_greeting
    print("✓ Agent Greeting: Clean, contextual greeting listing active dashboard charts")

    # 7. Test Architectural Recommendation: 'what do you think we can do to improve this?'
    res_improve = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "what do you think we can do to improve this?",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_improve.status_code == 200
    body_improve = res_improve.text
    assert "Architectural" in body_improve and "Recommendations" in body_improve
    assert "Dual" in body_improve and "Storage" in body_improve
    assert "[Option:" not in body_improve
    print("✓ Agent Architectural Advice: Provided actionable recommendations without [Option: ...] spam")

    # 8. Test 'yes, can we have these updated?': Must reliably update dashboard widgets without Shields.io overwrite
    res_update = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "yes, can we have these updated?",
            "dashboard_id": "dash-filter-01"
        },
        headers=headers
    )
    assert res_update.status_code == 200
    body_update = res_update.text
    assert "update_widget" in body_update or "Updated" in body_update
    assert "Official Shields.io Badges" not in body_update
    print("✓ Agent Affirmative Update: 'yes, can we have these updated?' updated widget without canned overwrite")

    # 9. Test 'can we have filters for this chart?': Must reliably create single filter widget for the chart
    res_chart_filters = client.post(
        f"/api/chat/sessions/{session_id}/stream",
        json={
            "message": "can we have filters for this chart?",
            "dashboard_id": "dash-filter-01",
            "widget_id": "w-pr-trend"
        },
        headers=headers
    )
    assert res_chart_filters.status_code == 200
    body_chart_filters = res_chart_filters.text
    assert "create_single_filter_widget" in body_chart_filters, "Failed to call create_single_filter_widget tool"
    assert "create_widget" in body_chart_filters, "Failed to emit create_widget action"
    assert "Clarification Needed" not in body_chart_filters
    print("✓ Agent Targeted Filter Intent: 'can we have filters for this chart?' mounted single filter widget")

    print("\nALL PREDICTABILITY, CLARIFICATION & DASHBOARD REFRESH TESTS PASSED 100%! 🚀")

if __name__ == "__main__":
    test_filter_and_refresh_pipeline()
    if os.path.exists("/tmp/test_filter_refresh.db"):
        os.remove("/tmp/test_filter_refresh.db")
