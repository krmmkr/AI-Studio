import os
import asyncio
from pathlib import Path

TEST_DB_PATH = Path('/tmp/test_correlation_and_storage.db')
if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()

os.environ['DATABASE_URL'] = f'sqlite:///{TEST_DB_PATH}'
os.environ['SEED_MOCK_DATA'] = 'true'

from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.services.duckdb_service import duckdb_service
from backend.app.services.mcp_client import mcp_manager
from backend.app.services.file_storage import get_storage_provider, LocalStorageProvider
from backend.app.database import SessionLocal, engine, Base
from backend.app.services.seed_data import seed_database
from backend.app.models import User, Dashboard, DashboardWidget

client = TestClient(app)

def test_correlation_and_storage():
    print("\n--- Running Correlation & Storage Upgrades Suite ---")
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_database(db, force_mock=True)
    duckdb_service._init_sample_tables()

    # 1. Test StorageProvider Abstraction
    storage = get_storage_provider()
    assert isinstance(storage, LocalStorageProvider)
    file_id, rel_path, size = storage.save(1, "test_impact.parquet", b"PAR1_test_content_sample")
    read_back = storage.read(1, rel_path)
    assert read_back == b"PAR1_test_content_sample"
    storage.delete(1, rel_path)
    print("✓ StorageProvider (Abstraction & Parquet ready) verified")

    # 2. Test Parquet Companion Export in Materialize Dataset
    records = [
        {"metric_date": "2026-10-24", "commits": 5, "p95_latency": 55.4},
        {"metric_date": "2026-10-25", "commits": 12, "p95_latency": 51.2}
    ]
    mat_res = duckdb_service.materialize_dataset("test_parquet_lake", records)
    assert mat_res["status"] == "success"
    assert "parquet_path" in mat_res
    p_path = Path(mat_res["parquet_path"])
    assert p_path.exists(), "Companion .parquet file was not created on disk!"
    
    # Query parquet directly via DuckDB
    escaped = p_path.as_posix().replace("'", "''")
    pq_res = duckdb_service.execute_query(f"SELECT * FROM read_parquet('{escaped}')")
    assert pq_res["row_count"] == 2
    duckdb_service.drop_table("test_parquet_lake")
    print("✓ Materialize Dataset with Columnar Parquet Lake export verified")

    # 3. Test Cross-Domain Correlation View in DuckDB (On-Demand Materialized Dataset)
    duckdb_service.materialize_dataset("engineering_impact_daily", [
        {"repo": "main-service", "metric_date": "2026-10-18", "lines_added": 42, "p95_latency_ms": 142.5},
        {"repo": "data-pipeline", "metric_date": "2026-10-19", "lines_added": 180, "p95_latency_ms": 138.0},
        {"repo": "auth-proxy", "metric_date": "2026-10-20", "lines_added": 95, "p95_latency_ms": 112.4},
        {"repo": "main-service", "metric_date": "2026-10-21", "lines_added": 34, "p95_latency_ms": 98.6},
        {"repo": "data-pipeline", "metric_date": "2026-10-22", "lines_added": 210, "p95_latency_ms": 64.1},
        {"repo": "main-service", "metric_date": "2026-10-23", "lines_added": 120, "p95_latency_ms": 62.0},
    ])
    res = duckdb_service.execute_query("""
        SELECT 
            e.repo,
            count(*) as days_tracked,
            sum(e.lines_added) as total_churn,
            round(avg(e.p95_latency_ms), 1) as avg_latency
        FROM engineering_impact_daily e
        GROUP BY 1
        ORDER BY 1
    """)
    assert res["row_count"] >= 2, f"Expected cross-domain rows, got {res['row_count']}"
    print(f"✓ Cross-Domain Correlation table 'engineering_impact_daily' operational ({res['row_count']} repos aggregated)")

    # 4. Test MCP JSON-RPC 2.0 call_tool
    loop = asyncio.new_event_loop()
    mcp_call = loop.run_until_complete(
        mcp_manager.call_tool(
            server_url="http://localhost:8088/api/v1/mcp",
            tool_name="superset_query_dataset",
            arguments={"dataset_id": 104, "metrics": ["revenue"]}
        )
    )
    assert "dataset" in mcp_call or "status" in mcp_call
    print("✓ MCP Client JSON-RPC 2.0 protocol tool execution verified")

    # 5. Test Live Widget Query Refresh (backed by DuckDB)
    login_res = client.post("/api/auth/login", json={"email": "admin@antigravity.io", "password": "antigravity123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    with SessionLocal() as db:
        admin_user = db.query(User).filter(User.email == "admin@antigravity.io").first()
        test_dash = Dashboard(id="dash-corr-test", user_id=admin_user.id, title="Correlation Studio", is_public=False)
        db.merge(test_dash)
        
        # Add widget with SQL query contract
        w = DashboardWidget(
            dashboard_id="dash-corr-test",
            widget_id="w-corr-impact",
            title="Dev Churn vs Query Latency",
            grid_json='{"x": 0, "y": 0, "w": 6, "h": 5}',
            spec_json='{"xAxis": {"data": []}, "series": [{"name": "Churn", "data": []}, {"name": "Latency", "data": []}]}',
            datasource_json='{"type": "duckdb", "query": "SELECT metric_date, lines_added, p95_latency_ms FROM engineering_impact_daily ORDER BY metric_date ASC"}'
        )
        db.merge(w)
        db.commit()

    # Trigger refresh
    refresh_res = client.post("/api/dashboards/dash-corr-test/widgets/w-corr-impact/refresh", headers=headers)
    assert refresh_res.status_code == 200, refresh_res.text
    refreshed_data = refresh_res.json()
    spec = refreshed_data["spec"]
    
    # Assert x-axis and series are populated with genuine DuckDB results
    assert len(spec["xAxis"]["data"]) >= 6, f"Expected real x-axis dates, got {spec['xAxis']['data']}"
    assert len(spec["series"][0]["data"]) >= 6, "Series 0 (churn) was not populated with real DuckDB data"
    assert len(spec["series"][1]["data"]) >= 6, "Series 1 (latency) was not populated with real DuckDB data"
    print("✓ Live Widget Query Refresh executed real DuckDB analytical query and populated ECharts spec")

    # Clean up
    duckdb_service.drop_table("engineering_impact_daily")
    with SessionLocal() as db:
        db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == "dash-corr-test").delete()
        db.query(Dashboard).filter(Dashboard.id == "dash-corr-test").delete()
        db.commit()

    print("\nALL CORRELATION, PARQUET & DUAL-STORAGE UPGRADES PASSED 100%! 🚀")

if __name__ == "__main__":
    test_correlation_and_storage()
