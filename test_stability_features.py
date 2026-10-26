import os
import asyncio
import httpx
import json
from pathlib import Path

TEST_DB_PATH = Path('/tmp/test_stability_features.db')
if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()

os.environ['DATABASE_URL'] = f'sqlite:///{TEST_DB_PATH}'
os.environ['SEED_MOCK_DATA'] = 'true'

from backend.app.main import app
from backend.app.database import engine, Base, SessionLocal
from backend.app.services.seed_data import seed_database
from backend.app.services.duckdb_service import duckdb_service
from backend.app.services.antigravity_agent import get_dashboard_context

async def run_all_stability_tests():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_database(db, force_mock=True)
    db.close()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://testserver') as client:
        # 1. Login
        r_login = await client.post('/api/auth/login', json={
            'email': 'admin@antigravity.io',
            'password': 'antigravity123'
        })
        assert r_login.status_code == 200
        token = r_login.json()['access_token']
        headers = {'Authorization': f'Bearer {token}'}

        # 2. Get active dashboard
        r_dashboards = await client.get('/api/dashboards', headers=headers)
        assert r_dashboards.status_code == 200
        dashboards = r_dashboards.json()
        assert len(dashboards) > 0
        dash_id = dashboards[0]['id']

        # 3. Test Dashboard Source Selector & Binding (PUT /api/dashboards/{dash_id}/sources)
        sources_payload = [
            {'type': 'git', 'label': 'Git: hog', 'ref': '/home/kohul/ai/hog', 'id': 'hog'},
            {'type': 'duckdb', 'label': 'DuckDB: github_commits', 'ref': 'duckdb://github_commits', 'id': 'github_commits'}
        ]
        r_sources = await client.put(f'/api/dashboards/{dash_id}/sources', json={'sources': sources_payload}, headers=headers)
        assert r_sources.status_code == 200
        updated_dash = r_sources.json()
        assert 'datasources' in updated_dash
        assert len(updated_dash['datasources']) == 2
        print('✓ PUT /api/dashboards/{id}/sources successfully bound sources to dashboard')

        # 4. Verify GET /api/dashboards/{dash_id} includes bound datasources
        r_dash = await client.get(f'/api/dashboards/{dash_id}', headers=headers)
        assert r_dash.status_code == 200
        dash_detail = r_dash.json()
        assert len(dash_detail.get('datasources', [])) == 2
        print('✓ GET /api/dashboards/{id} returned bound datasources')

        # 5. Verify Prompt Scoping via get_dashboard_context
        ctx, widgets, comments, bound = get_dashboard_context(dash_id)
        assert len(bound) == 2
        assert '[BOUND DATA SOURCES FOR THIS DASHBOARD]' in ctx
        assert 'STRICT CONTEXT BOUNDARY' in ctx
        assert '- [GIT]: Git: hog' in ctx
        assert '- [DUCKDB]: DuckDB: github_commits' in ctx
        print('✓ get_dashboard_context strictly scoped prompt boundaries to bound sources')

        # 6. Test Agent Stream with DuckDB Materialization intent
        r_sess = await client.post('/api/chat/sessions', json={'title': 'Materialization Chat'}, headers=headers)
        sess_id = r_sess.json()['id']

        events = []
        async with client.stream(
            'POST',
            f'/api/chat/sessions/{sess_id}/stream',
            json={
                'message': 'materialize contributor churn into duckdb table',
                'dashboard_id': dash_id
            },
            headers=headers
        ) as stream:
            assert stream.status_code == 200
            async for line in stream.aiter_lines():
                if line.startswith('data: '):
                    events.append(json.loads(line[6:]))

        # Check for tool_call, tool_result, canvas_action or widget creation
        tool_calls = [e for e in events if e.get('type') == 'tool_call']
        assert any(tc.get('name') == 'duckdb_materialize_dataset' for tc in tool_calls), 'Materialize tool call missing'
        print('✓ Agent successfully called duckdb_materialize_dataset')

        # 7. Verify table exists in DuckDB and queryable
        query_res = duckdb_service.execute_query('SELECT * FROM hog_contributor_churn')
        assert query_res['row_count'] >= 5
        assert query_res['columns'] == ['author', 'commits', 'lines_added', 'lines_deleted', 'net_lines', 'file_count', 'category']
        print(f'✓ Materialized table in DuckDB queried successfully: {query_res["row_count"]} rows')

        # 8. Verify auto-binding of custom dataset to dashboard datasources
        r_dash_after = await client.get(f'/api/dashboards/{dash_id}', headers=headers)
        after_sources = r_dash_after.json().get('datasources', [])
        assert any(s.get('id') == 'hog_contributor_churn' for s in after_sources), 'Custom dataset not auto-bound'
        print('✓ Materialized dataset auto-bound to dashboard datasources_json')

        # 9. Verify Canvas Action emitted companion ECharts widget
        canvas_actions = [e for e in events if e.get('type') == 'canvas_action']
        assert any(ca.get('action') == 'create_widget' for ca in canvas_actions)
        print('✓ Companion ECharts chart emitted to dashboard canvas')

    # Cleanup test files from derived_datasets so no mock debris is left on disk
    duckdb_service.drop_table('hog_contributor_churn')
    TEST_DB_PATH.unlink(missing_ok=True)
    print('\nALL STABILITY, SCOPING & MATERIALIZATION TESTS PASSED 100%! 🚀')

if __name__ == '__main__':
    asyncio.run(run_all_stability_tests())
