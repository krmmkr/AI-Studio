import asyncio
import os
import json
from pathlib import Path
from backend.app.database import SessionLocal, ensure_db_schema
from backend.app.models import User, Dashboard, DashboardWidget, LocalRepository
from backend.app.services.git_service import git_service
from backend.app.services.antigravity_agent import antigravity_agent

def test_intent_agent_and_repos():
    print("\n--- Running Genuine Intent Agent & Repository Operations Suite ---")
    
    # 1. Verify Superset git repository exists and branch listing
    print("\n1. Testing Repository Branch Listing and Inspection...")
    superset_path = Path("local_data/repos/superset").resolve()
    assert superset_path.is_dir(), "local_data/repos/superset directory must exist"
    
    branch_info = git_service.get_repository_branches(str(superset_path))
    assert "current_branch" in branch_info
    assert "branches" in branch_info
    assert len(branch_info["branches"]) > 0
    assert "master" in branch_info["branches"]
    print(f"✓ Branches detected: {len(branch_info['branches'])} branches, active: '{branch_info['current_branch']}'")
    
    # 2. Test 1000 commits conventional commit analysis
    print("\n2. Testing Git Conventional Commit Analysis (1000 commits)...")
    analysis = git_service.analyze_repository_commits(str(superset_path), branch="master", limit=1000)
    assert analysis["total_commits"] == 1000, f"Expected 1000 commits, got {analysis['total_commits']}"
    assert "fix" in analysis["type_counts"], "Must extract 'fix' conventional commits"
    assert "feat" in analysis["type_counts"], "Must extract 'feat' conventional commits"
    assert len(analysis["top_committers"]) >= 5, "Must rank top committers"
    
    top_author_names = [c["author"] for c in analysis["top_committers"]]
    assert any("Bridge" in a or "Ghadersohi" in a or "Li" in a for a in top_author_names), \
        f"Must contain genuine Superset committers, found: {top_author_names[:5]}"
    print(f"✓ Extracted 1000 commits: {analysis['type_counts']}")
    print(f"✓ Top committers: {', '.join(top_author_names[:3])}")
    
    # 3. Test Genuine Agent Intent Execution (No Regex Shortcuts or Fake Responses)
    print("\n3. Testing End-to-End Agent Execution on User Prompt...")
    user_prompt = (
        'create a Vertical Bar Chart titled "Superset Contribution Analysis". '
        'using data source superset (GitHub Repository). '
        'with x-axis / dimension "Commiters, commit type (feat, fix etc)". '
        'and metrics: Contribution level (quantifying improvements / fixes made. '
        'Additional requirements: look for last 1000 commits only.'
    )
    
    with SessionLocal() as db:
        # Create test dashboard
        dash = Dashboard(
            id="test-e2e-superset-dash",
            title="E2E Superset Test Dashboard",
            user_id="admin-dev-id"
        )
        db.merge(dash)
        
        # Ensure superset is in LocalRepository
        existing_repo = db.query(LocalRepository).filter(LocalRepository.name == "superset").first()
        if not existing_repo:
            db.add(LocalRepository(
                name="superset",
                remote_url="https://github.com/apache/superset.git",
                local_path=str(superset_path),
                clone_type="full",
                default_branch="master"
            ))
        db.commit()

    async def run_agent():
        thoughts = []
        tool_calls = []
        tool_results = []
        canvas_actions = []
        tokens = []
        
        async for ev in antigravity_agent.stream_chat(
            user_message=user_prompt,
            history=[],
            mcp_configs=[],
            current_dashboard_id="test-e2e-superset-dash"
        ):
            etype = ev.get("type")
            if etype == "thought":
                thoughts.append(ev.get("content"))
            elif etype == "tool_call":
                tool_calls.append(ev)
            elif etype == "tool_result":
                tool_results.append(ev)
            elif etype == "canvas_action":
                canvas_actions.append(ev)
            elif etype == "token":
                tokens.append(ev.get("content"))
                
        return thoughts, tool_calls, tool_results, canvas_actions, tokens

    thoughts, tool_calls, tool_results, canvas_actions, tokens = asyncio.run(run_agent())
    
    # Verify thoughts were streamed
    assert len(thoughts) >= 2, f"Agent must stream thoughts, got {len(thoughts)}"
    print(f"✓ Agent streamed {len(thoughts)} real-time thoughts.")
    
    # Verify tool call was made
    assert len(tool_calls) >= 1, "Agent must invoke analyze_repository_commits tool"
    assert tool_calls[0]["name"] == "analyze_repository_commits"
    assert tool_calls[0]["args"]["repo"] == "superset"
    print(f"✓ Agent called tool: {tool_calls[0]['name']} with args: {tool_calls[0]['args']}")
    
    # Verify tool result returned real commits
    assert len(tool_results) >= 1
    assert tool_results[0]["result"]["status"] == "success"
    assert tool_results[0]["result"]["total_commits_analyzed"] == 1000
    print(f"✓ Tool result confirmed {tool_results[0]['result']['total_commits_analyzed']} commits analyzed.")
    
    # Verify canvas action was emitted
    assert len(canvas_actions) >= 1, "Agent must emit a canvas action to mount widget"
    widget = canvas_actions[0]["widget"]
    assert widget["title"] == "Superset Contribution Analysis"
    assert widget["widget_type"] == "echarts"
    
    spec = widget["spec"]
    assert "xAxis" in spec
    assert len(spec["xAxis"]["data"]) >= 5
    assert "series" in spec
    assert len(spec["series"]) >= 4  # stacked bars + line
    
    series_names = [s["name"] for s in spec["series"]]
    assert "Features (feat)" in series_names
    assert "Bug Fixes (fix)" in series_names
    assert "Total Contribution Level" in series_names
    print(f"✓ Widget '{widget['title']}' created with series: {series_names}")
    
    # Verify DB persistence
    with SessionLocal() as db:
        saved_widget = db.query(DashboardWidget).filter(
            DashboardWidget.dashboard_id == "test-e2e-superset-dash",
            DashboardWidget.widget_id == widget["id"]
        ).first()
        assert saved_widget is not None, "Widget must be persisted to database"
        assert saved_widget.title == "Superset Contribution Analysis"
    print("✓ Widget successfully persisted to database under dashboard.")
    
    print("\nALL GENUINE INTENT & REPOSITORY OPERATIONS TESTS PASSED 100%! 🚀\n")

if __name__ == "__main__":
    test_intent_agent_and_repos()
