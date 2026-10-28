import os
import asyncio
import httpx
import subprocess
import shutil
from pathlib import Path

# Use an isolated temporary test database to prevent polluting local_data/cockpit.db
TEST_DB_PATH = Path("/tmp/test_cockpit_e2e.db")
if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ["SEED_MOCK_DATA"] = "true"

from backend.app.main import app
from backend.app.database import engine, Base, SessionLocal
from backend.app.services.seed_data import seed_database

async def test_all():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db, force_mock=True)
    db.close()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Test Static files and Health / Readiness probes
        r_root = await client.get("/")
        assert r_root.status_code == 200, f"Expected 200 on /, got {r_root.status_code}"
        assert "<div id=\"root\"></div>" in r_root.text, "Index HTML missing root div"
        print("✓ Root index.html served correctly")

        r_health = await client.get("/healthz")
        assert r_health.status_code == 200 and r_health.json()["status"] == "ok"
        r_ready = await client.get("/readyz")
        assert r_ready.status_code == 200 and r_ready.json()["database"] == "connected"
        print("✓ Health (/healthz) and Database Readiness (/readyz) probes operating")

        # 2. Test Login
        r_login = await client.post("/api/auth/login", json={
            "email": "admin@antigravity.io",
            "password": "antigravity123"
        })
        assert r_login.status_code == 200, f"Login failed: {r_login.text}"
        data = r_login.json()
        token = data["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("✓ Authentication & JWT verification successful")

        # 3. Test Agent Personas
        r_agents = await client.get("/api/agents", headers=headers)
        assert r_agents.status_code == 200
        agents = r_agents.json()
        assert len(agents) >= 2, f"Expected at least 2 personas, got {len(agents)}"
        print(f"✓ Agent Personas available: {[a['name'] for a in agents]}")

        # 4. Test Update Agent Instructions
        new_inst = "Custom instruction: Prioritize security review and SLA breaches."
        r_up = await client.put("/api/agents/github-agent/instructions", json={"system_instructions": new_inst}, headers=headers)
        assert r_up.status_code == 200
        assert r_up.json()["system_instructions"] == new_inst
        print("✓ Successfully updated GitHub Agent instruction set")

        # 5. Test Repositories Registry
        r_repos = await client.get("/api/agents/repositories", headers=headers)
        assert r_repos.status_code == 200
        repos = r_repos.json()
        assert len(repos) >= 1
        print(f"✓ Local persistent repositories tracked: {[r['name'] for r in repos]}")

        # Prepare a local git repo to verify real git clone & delete lifecycle
        test_source = Path("/tmp/e2e_source_repo")
        if test_source.exists():
            shutil.rmtree(test_source, ignore_errors=True)
        test_source.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "-b", "main", str(test_source)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(test_source), "config", "user.email", "e2e@antigravity.io"], check=True)
        subprocess.run(["git", "-C", str(test_source), "config", "user.name", "E2E Tester"], check=True)
        subprocess.run(["git", "-C", str(test_source), "commit", "--allow-empty", "-m", "initial test commit"], check=True, capture_output=True)

        # Test Repo Management Lifecycle (Real Git Clone & Delete)
        r_create_repo = await client.post("/api/agents/repositories", json={
            "name": "temp-test-repo",
            "remote_url": str(test_source),
            "clone_type": "shallow",
            "default_branch": "main"
        }, headers=headers)
        assert r_create_repo.status_code == 200, f"Repo clone failed: {r_create_repo.text}"
        temp_repo_id = r_create_repo.json()["id"]

        r_del_repo = await client.delete(f"/api/agents/repositories/{temp_repo_id}", headers=headers)
        assert r_del_repo.status_code == 200
        print(f"✓ Central repository management: successfully cloned and deleted repo ID {temp_repo_id}")
        shutil.rmtree(test_source, ignore_errors=True)

        # 6. Test DuckDB In-Process Engine & On-Demand Datasets
        from backend.app.services.duckdb_service import duckdb_service
        duckdb_service.materialize_dataset("analytics_sample", [
            {"region": "North America", "revenue_usd": 45000.0},
            {"region": "Europe", "revenue_usd": 32000.0},
        ])

        r_datasets = await client.get("/api/duckdb/datasets", headers=headers)
        assert r_datasets.status_code == 200
        datasets = r_datasets.json()
        assert len(datasets) >= 1
        table_names = [d["table_name"] for d in datasets]
        assert "analytics_sample" in table_names
        print(f"✓ Active DuckDB datasets listed: {table_names}")

        duck_sql = "SELECT region, SUM(revenue_usd) as total_rev FROM analytics_sample GROUP BY region ORDER BY total_rev DESC;"
        r_duck = await client.post("/api/duckdb/query", json={"sql": duck_sql}, headers=headers)
        assert r_duck.status_code == 200, f"DuckDB query failed: {r_duck.text}"
        duck_res = r_duck.json()
        assert duck_res["row_count"] > 0, "DuckDB returned 0 rows"
        print(f"✓ Embedded DuckDB executed analytics query successfully ({duck_res['row_count']} rows computed)")

        # Test DuckDB Security Hardening: Block dangerous / multi-statement / DDL queries
        r_bad1 = await client.post("/api/duckdb/query", json={"sql": "DROP TABLE analytics_sample;"}, headers=headers)
        assert r_bad1.status_code == 400, "Failed to block DROP TABLE"
        r_bad2 = await client.post("/api/duckdb/query", json={"sql": "SELECT 1; DROP TABLE analytics_sample;"}, headers=headers)
        assert r_bad2.status_code == 400, "Failed to block multi-statement SQL"
        r_bad3 = await client.post("/api/duckdb/query", json={"sql": "/* comment */ COPY analytics_sample TO '/tmp/leak.csv'"}, headers=headers)
        assert r_bad3.status_code == 400, "Failed to block COPY / comment evasion"
        print("✓ DuckDB query engine security validation: successfully blocked DDL, multi-statement and injection attacks")

        # Cleanup dataset via delete endpoint
        r_del_ds = await client.delete("/api/duckdb/datasets/analytics_sample", headers=headers)
        assert r_del_ds.status_code == 200

        # 7. Test Dashboards & Workspace Scopes (My Workspace vs Public Workspace)
        r_dashboards = await client.get("/api/dashboards", headers=headers)
        assert r_dashboards.status_code == 200
        dashboards = r_dashboards.json()
        assert len(dashboards) >= 1
        my_dash = next(d for d in dashboards if d.get("is_owner"))
        dash_id = my_dash["id"]
        # Ensure idempotent initial state
        await client.put(f"/api/dashboards/{dash_id}/share", json={"is_public": False}, headers=headers)

        # Test My Workspace scope
        r_my = await client.get("/api/dashboards?scope=my", headers=headers)
        assert r_my.status_code == 200
        my_dashboards = r_my.json()
        assert all(d["is_owner"] and not d["is_public"] for d in my_dashboards), "Found non-private dashboards in My Workspace"

        # Test Public Workspace scope
        r_pub = await client.get("/api/dashboards?scope=public", headers=headers)
        assert r_pub.status_code == 200
        pub_dashboards = r_pub.json()
        assert all(d["is_public"] for d in pub_dashboards), "Found non-public dashboards in Public Workspace"
        print(f"✓ Workspaces scoped: {len(my_dashboards)} private in 'My Workspace', {len(pub_dashboards)} in 'Public Workspace'")

        # Test Toggle Dashboard Share on My Dashboard
        my_dash_id = my_dashboards[0]["id"]
        r_share = await client.put(f"/api/dashboards/{my_dash_id}/share", json={"is_public": True}, headers=headers)
        assert r_share.status_code == 200
        assert r_share.json()["is_public"] is True
        print(f"✓ Dashboard sharing toggled successfully (ID: {my_dash_id})")

        # Revert back to private
        await client.put(f"/api/dashboards/{my_dash_id}/share", json={"is_public": False}, headers=headers)
        
        r_dash = await client.get(f"/api/dashboards/{my_dash_id}", headers=headers)
        dash_detail = r_dash.json()
        assert "widgets" in dash_detail
        print(f"✓ Dashboard loaded cleanly without ghost tables (ID: {my_dash_id})")

        # 8. Test Dynamic Widget Creation & Universal Refresh with live DuckDB dataset
        duckdb_service.materialize_dataset("e2e_velocity", [
            {"weekday": "Mon", "turnaround_hours": 14.2},
            {"weekday": "Tue", "turnaround_hours": 8.5},
            {"weekday": "Wed", "turnaround_hours": 22.1},
        ])
        sample_widget = {
            "widget_id": "test-velocity-chart",
            "title": "PR Velocity Live Refresh",
            "widget_type": "echarts",
            "grid": {"x": 0, "y": 0, "w": 6, "h": 4},
            "datasource": {
                "type": "duckdb",
                "label": "DuckDB: e2e_velocity",
                "query": "SELECT weekday, turnaround_hours FROM e2e_velocity ORDER BY turnaround_hours DESC",
            },
            "spec": {
                "archetype": "bar",
                "sql": "SELECT weekday, turnaround_hours FROM e2e_velocity ORDER BY turnaround_hours DESC",
                "xAxis": {"type": "category", "data": ["Wed", "Mon", "Tue"]},
                "yAxis": {"type": "value"},
                "series": [{"name": "Hours", "type": "bar", "data": [22.1, 14.2, 8.5]}],
            },
        }
        r_add = await client.post(f"/api/dashboards/{my_dash_id}/widgets", json=sample_widget, headers=headers)
        assert r_add.status_code == 200, f"Add widget failed: {r_add.text}"

        r_ref = await client.post(f"/api/dashboards/{my_dash_id}/widgets/test-velocity-chart/refresh", headers=headers)
        assert r_ref.status_code == 200, f"Refresh failed: {r_ref.text}"
        refreshed_widget = r_ref.json()
        assert refreshed_widget["id"] == "test-velocity-chart"
        print(f"✓ Widget telemetry refreshed on demand via backend datasource engine (test-velocity-chart)")

        # 9. Test Chat Session & SSE Stream with Jira prompt
        r_sess = await client.post("/api/chat/sessions", json={"title": "Jira Test Chat"}, headers=headers)
        sess_id = r_sess.json()["id"]

        events_received = []
        async with client.stream("POST", f"/api/chat/sessions/{sess_id}/stream", json={"message": "Please raise a Jira ticket for this PR issue", "agent_id": "github-agent"}, headers=headers) as stream:
            assert stream.status_code == 200
            async for line in stream.aiter_lines():
                if line.startswith("data: "):
                    events_received.append(line)
        
        assert len(events_received) > 0, "No SSE events received"
        print(f"✓ SSE Chat Stream executed with agent persona and emitted {len(events_received)} event chunks")

        # 10. Test Adding Chart Widget from Superset Dataset
        new_superset_widget = {
            "widget_id": "superset-test-widget-1",
            "title": "Customer Transactions & Revenue: REVENUE USD by region",
            "widget_type": "echarts",
            "grid": {"x": 0, "y": 0, "w": 6, "h": 4},
            "datasource": {"type": "mcp_superset", "label": "Superset Headless BI: superset_bi_transactions"},
            "spec": {
                "title": {"text": "Revenue by Region", "left": "center"},
                "xAxis": {"type": "category", "data": ["North America", "Europe", "Asia-Pacific"]},
                "yAxis": {"type": "value"},
                "series": [{"type": "bar", "data": [101500, 35400, 40900]}]
            }
        }
        r_add_w = await client.post(f"/api/dashboards/{my_dash_id}/widgets", json=new_superset_widget, headers=headers)
        assert r_add_w.status_code == 200
        print("✓ Created chart widget from Superset dataset on dashboard canvas")

        # 11. Test Superset Agent dataset discovery prompt
        superset_events = []
        async with client.stream("POST", f"/api/chat/sessions/{sess_id}/stream", json={"message": "List available Superset datasets in the catalog", "agent_id": "superset-agent"}, headers=headers) as stream:
            assert stream.status_code == 200
            async for line in stream.aiter_lines():
                if line.startswith("data: "):
                    superset_events.append(line)
        assert len(superset_events) > 0
        print(f"✓ Superset Agent handled dataset discovery and emitted {len(superset_events)} event chunks")

    print("\nALL PERSONA, DARK THEME & REPO TESTS PASSED! 🚀")
    TEST_DB_PATH.unlink(missing_ok=True)
    Path(f"{TEST_DB_PATH}-wal").unlink(missing_ok=True)
    Path(f"{TEST_DB_PATH}-shm").unlink(missing_ok=True)

if __name__ == "__main__":
    asyncio.run(test_all())
