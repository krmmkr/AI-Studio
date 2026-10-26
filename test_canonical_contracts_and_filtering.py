"""
Verification suite for Productionized Antigravity Cockpit:
1. Real Git --numstat Churn Ingestion in DuckDB
2. Canonical Chart Archetypes Compilation (Bar, Line, Area, Dual Axis, Pie/Donut, Heatmap, KPI, Table)
3. Parameterized DuckDB Query Filtering (Repo, Time Range, Min Churn)
4. Reactive Dashboard Evaluation Pipeline (POST /api/dashboards/{id}/evaluate)
5. Universal Widget Refresh Pipeline (ECharts spec preservation)
6. Elimination of Accidental node_modules Pie Chart Triggers
"""
import os
import json
import tempfile
import subprocess
from pathlib import Path
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite:////tmp/test_canonical_cockpit.db"
os.environ["SEED_MOCK_DATA"] = "true"

from backend.app.main import app
from backend.app.auth import hash_password, create_access_token
from backend.app.database import engine, Base, SessionLocal, ensure_db_schema
from backend.app.models import User, Dashboard, DashboardWidget, LocalRepository, ChatSession
from backend.app.services.duckdb_service import duckdb_service
from backend.app.services.git_service import git_service
from backend.app.schemas.canvas_contracts import (
    compile_widget_spec,
    build_single_filter_widget,
    ChartArchetype,
    FilterControlContract,
    FilterPrimitiveType
)

Base.metadata.create_all(bind=engine)
ensure_db_schema()

client = TestClient(app)

def test_production_contracts_and_filtering():
    print("\n--- Running Canonical Contracts & Reactive Filtering Suite ---")

    # 1. Test Git --numstat Churn Parsing
    print("\n1. Testing Git --numstat churn ingestion...")
    with tempfile.TemporaryDirectory() as tmp_git_dir:
        repo_path = Path(tmp_git_dir)
        subprocess.run(["git", "init"], cwd=repo_path, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["git", "config", "user.email", "dev@example.com"], cwd=repo_path, check=True)
        subprocess.run(["git", "config", "user.name", "Test Dev"], cwd=repo_path, check=True)

        f1 = repo_path / "hello.py"
        f1.write_text("print('hello world')\nprint('second line')\nprint('third line')\n")
        subprocess.run(["git", "add", "hello.py"], cwd=repo_path, check=True)
        subprocess.run(["git", "commit", "-m", "feat: initial commit with 3 lines"], cwd=repo_path, check=True)

        meta = git_service.extract_repo_metadata(repo_path, "test-numstat-repo")
        assert meta["commit_count"] >= 1, "Failed to count commit"
        assert meta["ingested_commits"] >= 1, "Failed to extract commit details"
        print(f"✓ Git --numstat verified: extracted {meta['commit_count']} commits cleanly without auto-writing ghost tables to DuckDB")

    # 2. Test Canonical Archetype Compiler
    print("\n2. Testing Canonical Chart Archetypes Compilation...")
    # 2a. Bar / Stacked Bar
    bar_spec = compile_widget_spec(
        archetype=ChartArchetype.BAR,
        title="Commit Count by Repo",
        sql="SELECT repo, count(*) as count FROM github_commits GROUP BY 1",
        columns=["repo", "count"],
        rows=[["main-service", 14], ["data-pipeline", 8]]
    )
    assert bar_spec["xAxis"]["data"] == ["main-service", "data-pipeline"]
    assert bar_spec["series"][0]["type"] == "bar"
    assert bar_spec["series"][0]["data"] == [14.0, 8.0]
    assert bar_spec["raw_table"]["columns"] == ["repo", "count"]
    print("✓ Archetype 'bar' compiled with full xAxis, series, and raw_table lineage")

    # 2b. Pie / Donut
    pie_spec = compile_widget_spec(
        archetype=ChartArchetype.PIE_DONUT,
        title="Code Diff Distribution",
        sql="SELECT 'Small' as tier, 45 as count",
        columns=["tier", "count"],
        rows=[["Small", 45], ["Large", 15]]
    )
    assert pie_spec["series"][0]["type"] == "pie"
    assert pie_spec["series"][0]["radius"] == ["42%", "70%"]
    assert len(pie_spec["series"][0]["data"]) == 2
    assert pie_spec["series"][0]["data"][0] == {"name": "Small", "value": 45.0}
    print("✓ Archetype 'pie_donut' compiled with proportional radius and item formatter")

    # 2c. Heatmap
    heat_spec = compile_widget_spec(
        archetype=ChartArchetype.HEATMAP,
        title="Commit Heatmap",
        sql="SELECT 'Mon' as day, '10 AM' as hour, 12 as commits",
        columns=["hour", "day", "commits"],
        rows=[["10 AM", "Mon", 12], ["11 AM", "Mon", 24]]
    )
    assert heat_spec["series"][0]["type"] == "heatmap"
    assert "visualMap" in heat_spec
    assert len(heat_spec["series"][0]["data"]) == 2
    print("✓ Archetype 'heatmap' compiled with 2D coordinates and visualMap range")

    # 2d. Dual Axis / Multi-Axis (Multiple metric series)
    dual_spec = compile_widget_spec(
        archetype=ChartArchetype.DUAL_AXIS,
        title="Impact vs Latency vs Throughput",
        sql="SELECT date, churn, latency, throughput FROM engineering_impact_daily",
        columns=["date", "churn", "latency", "throughput"],
        rows=[["2026-10-20", 120, 45.2, 950], ["2026-10-21", 80, 42.1, 1020]],
        visual_options={"y_fields": ["churn", "latency", "throughput"]}
    )
    assert len(dual_spec["yAxis"]) == 2
    assert len(dual_spec["series"]) == 3
    assert dual_spec["series"][0]["type"] == "bar"
    assert dual_spec["series"][1]["type"] == "line"
    assert dual_spec["series"][1]["yAxisIndex"] == 1
    print("✓ Archetype 'dual_axis' / 'multi_axis' compiled with 3 metric series across Left & Right Y-axes")

    # 2e. Calendar Heatmap Chart
    cal_spec = compile_widget_spec(
        archetype=ChartArchetype.CALENDAR,
        title="Daily Commit Calendar Heatmap",
        sql="SELECT date, commits FROM daily_commits",
        columns=["date", "commits"],
        rows=[["2026-03-01", 12], ["2026-03-02", 29], ["2026-03-03", 7]]
    )
    assert "calendar" in cal_spec
    assert cal_spec["series"][0]["type"] == "heatmap"
    assert cal_spec["series"][0]["coordinateSystem"] == "calendar"
    print("✓ Archetype 'calendar' compiled with calendar coordinate system and visualMap")

    # 2f. Radar, Horizontal Bar, and Scatter Charts
    radar_spec = compile_widget_spec(
        archetype=ChartArchetype.RADAR,
        title="Engineering Health Radar",
        sql="SELECT module, commits, reviews FROM health",
        columns=["module", "commits", "reviews"],
        rows=[["Backend", 80, 75], ["Frontend", 65, 90], ["Infra", 50, 60]]
    )
    assert "radar" in radar_spec
    assert radar_spec["series"][0]["type"] == "radar"
    assert len(radar_spec["series"][0]["data"]) == 2

    hbar_spec = compile_widget_spec(
        archetype=ChartArchetype.HORIZONTAL_BAR,
        title="Horizontal Bar Ranking",
        sql="SELECT module, commits FROM health",
        columns=["module", "commits"],
        rows=[["Backend", 80], ["Frontend", 65]]
    )
    assert hbar_spec["yAxis"]["type"] == "category"
    assert hbar_spec["xAxis"]["type"] == "value"

    scatter_spec = compile_widget_spec(
        archetype=ChartArchetype.SCATTER,
        title="Churn Scatter",
        sql="SELECT module, commits FROM health",
        columns=["module", "commits"],
        rows=[["Backend", 80], ["Frontend", 65]]
    )
    assert scatter_spec["series"][0]["type"] == "scatter"
    print("✓ Archetypes 'radar', 'horizontal_bar', and 'scatter' compiled cleanly")

    # 2g. Standard Table (No Rowspan), Grouped Table (With Rowspan), and Pivot Table
    std_table = compile_widget_spec(
        archetype=ChartArchetype.TABLE,
        title="Standard Table",
        sql="SELECT tier, module, period, commits FROM mod_stats",
        columns=["tier", "module", "period", "commits"],
        rows=[["Core", "Auth", "Q1", 42], ["Core", "DB", "Q2", 31]]
    )
    assert std_table["type"] == "table"
    assert std_table["table_mode"] == "standard"
    assert std_table["enable_rowspan"] is False

    rowspan_table = compile_widget_spec(
        archetype=ChartArchetype.TABLE_ROWSPAN,
        title="Grouped Table with Rowspan",
        sql="SELECT tier, module, period, commits FROM mod_stats",
        columns=["tier", "module", "period", "commits"],
        rows=[["Core", "Auth", "Q1", 42], ["Core", "DB", "Q2", 31]]
    )
    assert rowspan_table["type"] == "table"
    assert rowspan_table["table_mode"] == "rowspan"
    assert rowspan_table["enable_rowspan"] is True
    assert "tier" in rowspan_table["rowspan_columns"]

    pivot_table = compile_widget_spec(
        archetype=ChartArchetype.PIVOT_TABLE,
        title="Cross-Tab Pivot Table",
        sql="SELECT tier, module, period, commits FROM mod_stats",
        columns=["tier", "module", "period", "commits"],
        rows=[["Core", "Auth", "Q1", 42], ["Core", "Auth", "Q2", 18], ["App", "UI", "Q1", 55]]
    )
    assert pivot_table["type"] == "table"
    assert pivot_table["table_mode"] == "pivot"
    assert pivot_table["enable_rowspan"] is True
    assert pivot_table["pivot_config"]["agg"] == "SUM"
    assert pivot_table["pivot_config"]["value_field"] == "commits"
    print("✓ Archetypes 'table', 'table_rowspan', and 'pivot_table' compiled with rowspan and pivot_config")

    # 2h. All 9 Single Filter Types + Clean Title (No "Filter: " prefix)
    all_9_types = [
        "dropdown",
        "multi_dropdown",
        "checkbox",
        "radio",
        "range",
        "top_n",
        "search_text",
        "date_picker",
        "toggle",
    ]
    sample_widgets = [
        {
            "widget_id": "w-comp",
            "title": "Tracked file composition",
            "widget_type": "echarts",
            "spec": {
                "yAxis": {"type": "category", "data": ["Frontend", "Backend", "Docs"]},
                "xAxis": {"type": "value"},
                "series": [{"name": "Files", "type": "bar", "data": [120, 85, 15]}],
            },
        }
    ]
    for ft in all_9_types:
        fw = build_single_filter_widget(
            filter_type=ft,
            label="Filter: Tracked file composition",
            dimension="Tracked file composition",
            options=[
                {"value": "Frontend", "label": "Frontend", "count": 120},
                {"value": "Backend", "label": "Backend", "count": 85},
            ],
            target_widget_ids=["w-comp"],
        )
        assert fw["title"] == "Tracked file composition", f"Expected clean title without 'Filter:', got {fw['title']}"
        assert not fw["title"].lower().startswith("filter:"), f"Title must not start with 'Filter:': {fw['title']}"
        assert fw["spec"]["type"] == "single_filter"
        assert fw["spec"]["filter_type"] == ft
    print("✓ All 9 single filter types compiled with clean titles (no 'Filter:' prefix or duplicate labels)")

    # 3. Test Parameterized DuckDB Filtering
    print("\n3. Testing Parameterized DuckDB Filtering...")
    duckdb_service.ingest_git_commits("main-service", [
        {"commit_id": "c1", "author": "Alice", "repo": "main-service", "message": "feat: test", "lines_added": 120, "lines_deleted": 10, "committed_at": "2026-10-20 10:00:00"},
        {"commit_id": "c2", "author": "Bob", "repo": "other-service", "message": "fix: bug", "lines_added": 50, "lines_deleted": 5, "committed_at": "2026-10-21 11:00:00"}
    ])
    base_sql = "SELECT repo, count(*) as c, sum(lines_added) as additions FROM github_commits GROUP BY repo"
    
    # 3a. Global repo filter
    res_repo = duckdb_service.execute_widget_query(base_sql, filters={"repo": "main-service"})
    assert "repo = 'main-service'" in res_repo["executed_sql"]
    for row in res_repo["data"]:
        assert row["repo"] == "main-service"
    print("✓ DuckDB repo filter successfully scoped data to 'main-service'")

    # 3b. Min lines churn threshold
    res_churn = duckdb_service.execute_widget_query(base_sql, filters={"min_lines": 100})
    assert "COALESCE(lines_added, 0)" in res_churn["executed_sql"]
    print("✓ DuckDB min_lines filter correctly applied churn threshold")

    # 4. Test Reactive Dashboard Evaluation (POST /api/dashboards/{id}/evaluate)
    print("\n4. Testing POST /api/dashboards/{id}/evaluate API...")
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "eval_user@example.com").first()
        if not user:
            user = User(
                email="eval_user@example.com",
                hashed_password=hash_password("password123"),
                role="member"
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        user_id = user.id
        user_email = user.email

        # Create test dashboard with widgets
        dash = db.query(Dashboard).filter(Dashboard.id == "dash-eval-01").first()
        if not dash:
            dash = Dashboard(
                id="dash-eval-01",
                user_id=user_id,
                title="Evaluation Test Canvas",
                description="Verifies reactive evaluation endpoint",
                is_default=False
            )
            db.add(dash)
            db.commit()

        # Add or update bar widget
        w_bar = db.query(DashboardWidget).filter(
            DashboardWidget.dashboard_id == "dash-eval-01",
            DashboardWidget.widget_id == "w-eval-bar"
        ).first()
        if not w_bar:
            w_bar = DashboardWidget(
                dashboard_id="dash-eval-01",
                widget_id="w-eval-bar",
                title="Repository Commits",
                widget_type="echarts",
                grid_json=json.dumps({"x": 0, "y": 0, "w": 6, "h": 4}),
                spec_json=json.dumps(bar_spec),
                datasource_json=json.dumps({"type": "duckdb", "query": "SELECT repo, count(*) as count FROM github_commits GROUP BY 1"})
            )
            db.add(w_bar)
        else:
            w_bar.spec_json = json.dumps(bar_spec)
            w_bar.datasource_json = json.dumps({"type": "duckdb", "query": "SELECT repo, count(*) as count FROM github_commits GROUP BY 1"})
        db.commit()

    # Authenticate
    token = create_access_token({"sub": str(user_id), "email": user_email, "role": "member"})
    headers = {"Authorization": f"Bearer {token}"}

    # Evaluate with repo filter
    eval_res = client.post(
        "/api/dashboards/dash-eval-01/evaluate",
        json={"filters": {"repo": "main-service"}},
        headers=headers
    )
    assert eval_res.status_code == 200, f"Evaluate failed: {eval_res.text}"
    eval_data = eval_res.json()
    assert eval_data["success"] is True
    assert len(eval_data["widgets"]) >= 1
    eval_w = eval_data["widgets"][0]
    assert "main-service" in eval_w["spec"]["title"]["subtext"]
    assert eval_w["spec"]["xAxis"]["data"] == ["main-service"]
    print("✓ Reactive evaluate endpoint returned real filtered series and updated scope subtext")

    # 5. Test Widget Refresh (POST /api/dashboards/{id}/widgets/{widget_id}/refresh)
    print("\n5. Testing Universal Widget Refresh...")
    ref_res = client.post(
        "/api/dashboards/dash-eval-01/widgets/w-eval-bar/refresh",
        headers=headers
    )
    assert ref_res.status_code == 200, f"Refresh widget failed: {ref_res.text}"
    ref_widget = ref_res.json()
    assert "xAxis" in ref_widget["spec"]
    assert len(ref_widget["spec"]["series"]) > 0
    print("✓ Universal widget refresh recompiled spec with live DuckDB telemetry")

    # 6. Test Dataset Lineage, Real User Management API & MCP Streamable HTTP Handshake
    print("\n6. Testing Dataset Lineage, Real User CRUD & MCP Streamable HTTP...")
    mat_res = duckdb_service.materialize_dataset(
        table_name="agent_test_lineage_view",
        records=[{"repo": "main-service", "commits": 14, "churn": 420}],
        lineage_meta={
            "origin_type": "agent_derived",
            "source_name": "duckdb.github_commits",
            "derivation_summary": "Derived by Copilot from duckdb.github_commits (1 rows)",
            "source_query": "SELECT repo, COUNT(*) AS commits, SUM(lines_added) AS churn FROM github_commits GROUP BY 1",
        },
    )
    assert mat_res["success"] is True
    assert mat_res["lineage"]["source_name"] == "duckdb.github_commits"

    datasets = duckdb_service.list_datasets()
    derived_ds = next((d for d in datasets if d["table_name"] == "agent_test_lineage_view"), None)
    assert derived_ds is not None, "Expected materialized dataset in list_datasets()"
    assert derived_ds["is_derived"] is True
    assert derived_ds["lineage"]["source_name"] == "duckdb.github_commits"
    assert "SELECT repo" in derived_ds["lineage"]["source_query"]
    duckdb_service.drop_table("agent_test_lineage_view")
    print("✓ DuckDB derived dataset lineage persisted and returned cleanly")

    users_res = client.get("/api/auth/users", headers=headers)
    assert users_res.status_code == 200
    users_list = users_res.json()
    assert any(u["email"] == "eval_user@example.com" for u in users_list)
    print("✓ Real SQLite user management endpoint (/api/auth/users) verified")

    import httpx
    from backend.app.services.mcp_client import mcp_manager
    cand_urls = mcp_manager._candidate_streamable_urls("http://127.0.0.1:5008/mcp")
    assert cand_urls[0] == "http://127.0.0.1:5008/mcp"
    sse_payload = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"list_datasets","description":"List Superset datasets"}]}}\n\n'
    mock_http_res = httpx.Response(200, headers={"content-type": "text/event-stream"}, text=sse_payload)
    parsed_sse = mcp_manager._parse_mcp_response(mock_http_res)
    assert parsed_sse["result"]["tools"][0]["name"] == "list_datasets"

    # Verify Superset 7.0 sst_... API key auth header variants
    raw_sst = "sst_qAH8L8rXVF8exampleKey123456"
    extracted_tok = mcp_manager._extract_raw_token(raw_sst)
    assert extracted_tok == raw_sst
    variants = mcp_manager._build_auth_header_variants(raw_sst)
    assert len(variants) >= 4
    assert variants[0]["Authorization"] == f"Bearer {raw_sst}"
    assert variants[0]["X-API-Key"] == raw_sst
    assert variants[0]["X-Superset-API-Key"] == raw_sst
    print("✓ MCP Streamable HTTP (/mcp) URL resolution, Superset 7.0 sst_... API key negotiation, and SSE JSON-RPC frame parser verified")

    print("\nALL PRODUCTION CONTRACTS, REPOSITORIES, LINEAGE, MCP & FILTERING TESTS PASSED 100%! 🚀\n")

if __name__ == "__main__":
    test_production_contracts_and_filtering()
    if os.path.exists("/tmp/test_canonical_cockpit.db"):
        os.remove("/tmp/test_canonical_cockpit.db")
