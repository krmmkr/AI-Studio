import datetime
import json
import logging
import uuid
from sqlalchemy.orm import Session
from backend.app.auth import hash_password
from backend.app.config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, SEED_MOCK_DATA, REPOS_DIR
from backend.app.models import User, MCPConfig, Dashboard, DashboardWidget, AgentPersona, LocalRepository
from backend.app.services.git_service import git_service

logger = logging.getLogger("seed_data")


def sync_real_disk_repositories(db: Session, remove_fake_if_clean: bool = True):
    """Discovers real cloned repositories in REPOS_DIR, registers them, and ingests their commits into DuckDB."""
    if remove_fake_if_clean:
        from backend.app.models import DashboardComment
        fake_repos = (
            db.query(LocalRepository)
            .filter(LocalRepository.remote_url.like("%github.com/company/%"))
            .all()
        )
        for fr in fake_repos:
            if not git_service.is_repo_cloned(fr.local_path):
                db.delete(fr)

        # Remove duplicate .git-suffixed rows when sanitized name exists
        for r in db.query(LocalRepository).filter(LocalRepository.name.like("%.git")).all():
            clean = git_service.sanitize_repo_name(r.name)
            if clean != r.name:
                db.delete(r)

        mock_dash_ids = ["default-cockpit", "pr-velocity-audit"]
        db.query(DashboardComment).filter(DashboardComment.dashboard_id.in_(mock_dash_ids)).delete(synchronize_session=False)
        db.query(DashboardWidget).filter(DashboardWidget.dashboard_id.in_(mock_dash_ids)).delete(synchronize_session=False)
        db.query(Dashboard).filter(Dashboard.id.in_(mock_dash_ids)).delete(synchronize_session=False)
        db.query(MCPConfig).filter(MCPConfig.url.like("%.internal%")).delete(synchronize_session=False)
        db.commit()

    if not REPOS_DIR.exists():
        return

    for entry in sorted(REPOS_DIR.iterdir()):
        if not entry.is_dir() or not git_service.is_repo_cloned(str(entry)):
            continue
        safe_name = git_service.sanitize_repo_name(entry.name)
        rc, remote_out, _ = git_service._run_git(["config", "--get", "remote.origin.url"], cwd=entry)
        remote_url = remote_out.strip() if rc == 0 and remote_out.strip() else f"local://{entry.name}"

        try:
            meta = git_service.extract_repo_metadata(entry, safe_name)
        except Exception as e:
            logger.warning(f"Failed to extract metadata for {entry}: {e}")
            meta = {"branch": "main"}

        existing = db.query(LocalRepository).filter(LocalRepository.name == safe_name).first()
        if existing:
            existing.local_path = str(entry.resolve())
            if remote_url and not existing.remote_url:
                existing.remote_url = remote_url
            existing.default_branch = meta.get("branch") or existing.default_branch or "main"
            existing.last_synced_at = datetime.datetime.utcnow()
        else:
            db.add(
                LocalRepository(
                    name=safe_name,
                    remote_url=remote_url,
                    local_path=str(entry.resolve()),
                    clone_type="full",
                    default_branch=meta.get("branch", "main"),
                    last_synced_at=datetime.datetime.utcnow(),
                )
            )
    db.commit()


def seed_database(db: Session, force_mock: bool = False):
    """Seed initial user, MCP tools, and default dynamic dashboard widgets if configured."""
    # 1. Admin user (Always created)
    admin = db.query(User).filter(User.email == DEFAULT_ADMIN_EMAIL).first()
    if not admin:
        admin = User(
            email=DEFAULT_ADMIN_EMAIL,
            hashed_password=hash_password(DEFAULT_ADMIN_PASSWORD),
            role="admin"
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

    # 2. Agent Personas (Always created so the agent has system instructions)
    github_persona_instructions = (
        "You are the GitHub Engineering & Codebase Intelligence Specialist.\n\n"
        "Key Responsibilities:\n"
        "1. Dynamically inspect cloned GitHub repositories on disk (`local_data/repos/`) based on the user's exact request—including features/routes/components and who authored them, codebase issues/TODOs/FIXMEs and bugfix commits with authors, module ownership, AST complexity, or commit velocity.\n"
        "2. Do NOT assume fixed `github_commits` or `github_contributors` tables exist. Instead, use `extract_repository_dataset_records` or `propose_duckdb_dataset(table_name=..., description=..., records=[...])` to dynamically propose custom DuckDB tables tailored to the data needed.\n"
        "3. Communicate recommendations and architectural questions with `ask_user_confirmation` to give users clickable choice buttons directly in chat.\n"
        "4. Emit clear, data-backed Apache ECharts visualization widgets (`upsert_chart_widget`) and engineering reports (`create_markdown_report_widget`) onto the dashboard canvas without repeating boilerplate text."
    )
    personas = db.query(AgentPersona).all()
    if not personas:
        github_agent = AgentPersona(
            id="github-agent",
            name="GitHub Intelligence Agent",
            role_description="Specialist in codebase feature authorship, issue/tech-debt discovery, dynamic dataset creation, and repository analytics.",
            icon="git-pull-request",
            is_default=True,
            system_instructions=github_persona_instructions,
        )
        superset_agent = AgentPersona(
            id="superset-agent",
            name="Superset Headless BI Agent",
            role_description="Specialist in headless business intelligence, data catalog exploration, and dynamic analytical chart generation.",
            icon="bar-chart-3",
            is_default=False,
            system_instructions=(
                "You are the Superset Headless BI & Data Analytics Specialist.\n\n"
                "Key Responsibilities:\n"
                "1. Connect directly to Superset backend endpoints (`/api/v1/chart/data` and `/api/v1/sqllab/execute/`) via Superset MCP, completely skipping the Superset frontend.\n"
                "2. Use the Data Catalog MCP to discover semantic tables, column schemas, and metrics glossary (`analytics.customer_transactions_daily`).\n"
                "3. Formulate SQL slice queries to aggregate revenue, transaction volumes, user metrics, and query performance.\n"
                "4. Project dynamic, interactive ECharts widgets directly onto the canvas with clear legends, axes, and responsive tooltips."
            )
        )
        correlation_agent = AgentPersona(
            id="correlation-agent",
            name="Engineering Impact & ROI Agent",
            role_description="Correlates GitHub commit velocity, PR sizes, and SLA turnaround with Superset query latencies, API reliability, and business ARR.",
            icon="git-merge",
            is_default=False,
            system_instructions=(
                "You are the Engineering Impact & Cross-Domain Correlation Specialist.\n\n"
                "Key Responsibilities:\n"
                "1. Connect software engineering activity (PR review turnaround, commit churn, diff bottlenecks) with operational and business KPIs (database query latency, system errors, ARR growth).\n"
                "2. Query both GitHub datasets (`github_commits`) and Superset Headless BI metrics (`engineering_impact_daily`, `superset_query_performance`, `superset_saas_metrics`) to discover causal relationships.\n"
                "3. Emit dual-axis Apache ECharts visualizations (e.g. Commit Churn on left bar axis vs P95 Query Latency on right line axis) so engineering leaders immediately see the business impact of architectural work.\n"
                "4. When code changes reduce latencies or improve cache hit ratios, synthesize an impact audit card quantifying the engineering ROI."
            )
        )
        db.add_all([github_agent, superset_agent, correlation_agent])
        db.commit()
    else:
        gh_p = db.query(AgentPersona).filter(AgentPersona.id == "github-agent").first()
        if gh_p and "github_commits" in (gh_p.system_instructions or ""):
            gh_p.system_instructions = github_persona_instructions
            gh_p.role_description = "Specialist in codebase feature authorship, issue/tech-debt discovery, dynamic dataset creation, and repository analytics."
            db.commit()
        corr = db.query(AgentPersona).filter(AgentPersona.id == "correlation-agent").first()
        if not corr:
            correlation_agent = AgentPersona(
                id="correlation-agent",
                name="Engineering Impact & ROI Agent",
                role_description="Correlates GitHub commit velocity, PR sizes, and SLA turnaround with Superset query latencies, API reliability, and business ARR.",
                icon="git-merge",
                is_default=False,
                system_instructions=(
                    "You are the Engineering Impact & Cross-Domain Correlation Specialist.\n\n"
                    "Key Responsibilities:\n"
                    "1. Connect software engineering activity (PR review turnaround, commit churn, diff bottlenecks) with operational and business KPIs (database query latency, system errors, ARR growth).\n"
                    "2. Query both GitHub datasets (`github_commits`) and Superset Headless BI metrics (`engineering_impact_daily`, `superset_query_performance`, `superset_saas_metrics`) to discover causal relationships.\n"
                    "3. Emit dual-axis Apache ECharts visualizations (e.g. Commit Churn on left bar axis vs P95 Query Latency on right line axis) so engineering leaders immediately see the business impact of architectural work.\n"
                    "4. When code changes reduce latencies or improve cache hit ratios, synthesize an impact audit card quantifying the engineering ROI."
                )
            )
            db.add(correlation_agent)
            db.commit()

    # If mock data seeding is disabled (production or clean slate mode):
    if not SEED_MOCK_DATA and not force_mock:
        sync_real_disk_repositories(db, remove_fake_if_clean=True)
        # Ensure a clean default empty dashboard exists for admin if they have none
        existing_dash = db.query(Dashboard).filter(Dashboard.user_id == admin.id).first()
        if not existing_dash:
            clean_dash = Dashboard(
                id=str(uuid.uuid4()),
                user_id=admin.id,
                title="GitHub Intelligence Workspace",
                description="Analyze cloned GitHub repositories, materialize DuckDB datasets, and build interactive charts and reports.",
                is_default=True,
                is_public=False
            )
            db.add(clean_dash)
            db.commit()
        return

    sync_real_disk_repositories(db, remove_fake_if_clean=False)

    # --- SEED MOCK DATA (Only when SEED_MOCK_DATA=true) ---
    # Seed colleague user for public shared workspace demo
    colleague = db.query(User).filter(User.email == "sarah.lead@antigravity.io").first()
    if not colleague:
        colleague = User(
            email="sarah.lead@antigravity.io",
            hashed_password=hash_password("colleague123"),
            role="user"
        )
        db.add(colleague)
        db.commit()
        db.refresh(colleague)

    # 3. Global MCPs
    existing_mcps = db.query(MCPConfig).all()
    if not existing_mcps:
        global_superset = MCPConfig(
            name="Superset 7.0 Headless BI MCP",
            description="Org-wide Apache Superset 7.0 MCP server for running headless queries and aggregations.",
            scope="global",
            transport="sse",
            url="http://localhost:8088/api/v1/mcp",
            auth_header="Bearer superset_service_token",
            is_active=True,
            user_id=None
        )
        global_catalog = MCPConfig(
            name="Enterprise Data Catalog MCP",
            description="Internal Data Catalog MCP providing semantic schemas, table metadata, and metrics glossary.",
            scope="global",
            transport="http",
            url="http://localhost:9000/api/catalog/mcp",
            auth_header="Bearer catalog_read_token",
            is_active=True,
            user_id=None
        )
        user_jira = MCPConfig(
            name="Corporate Jira MCP",
            description="Jira MCP connection for automatically opening bug and tracking tickets from code review defects.",
            scope="user",
            transport="http",
            url="http://localhost:8080/jira/mcp",
            auth_header="Bearer jira_api_token_demo",
            is_active=True,
            user_id=admin.id
        )
        user_github = MCPConfig(
            name="Personal GitHub MCP",
            description="Personal GitHub token for inspecting private repositories, pull request reviews, and commit churn.",
            scope="user",
            transport="sse",
            url="http://localhost:3000/github/sse",
            auth_header="token ghp_personal_developer_token_demo",
            is_active=True,
            user_id=admin.id
        )
        db.add_all([global_superset, global_catalog, user_github, user_jira])
        db.commit()

    # 3. Default Dashboard
    default_dashboard = db.query(Dashboard).filter(Dashboard.user_id == admin.id, Dashboard.is_default == True).first()
    if not default_dashboard:
        dash_id = str(uuid.uuid4())
        default_dashboard = Dashboard(
            id=dash_id,
            user_id=admin.id,
            title="Engineering & BI Intelligence Studio",
            description="Real-time cockpit combining GitHub developer productivity with Superset headless BI metrics.",
            is_default=True
        )
        db.add(default_dashboard)
        db.commit()

        # Seed 4 rich widgets
        # Widget 1: GitHub PR Velocity (Hours to merge across weekdays)
        w1_spec = {
            "title": {"text": "Weekly PR Turnaround & Merge Velocity", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
            "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
            "grid": {"left": "3%", "right": "4%", "bottom": "10%", "top": "18%", "containLabel": True},
            "xAxis": {"type": "category", "data": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]},
            "yAxis": {"type": "value", "name": "Hours to Merge"},
            "series": [
                {
                    "name": "Avg Review Time",
                    "type": "bar",
                    "data": [14.2, 8.5, 22.1, 6.4, 12.0, 3.2, 2.1],
                    "itemStyle": {"color": "#6750A4", "borderRadius": [8, 8, 0, 0]}
                },
                {
                    "name": "Target SLA",
                    "type": "line",
                    "data": [10, 10, 10, 10, 10, 10, 10],
                    "itemStyle": {"color": "#B3261E"},
                    "lineStyle": {"type": "dashed"}
                }
            ]
        }

        # Widget 2: GitHub Commit Activity Heatmap (Day of Week vs Time Slot)
        hours = ["9 AM", "11 AM", "1 PM", "3 PM", "5 PM", "7 PM", "9 PM"]
        days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
        heatmap_data = [
            [0, 0, 12], [0, 1, 24], [0, 2, 45], [0, 3, 38], [0, 4, 18], [0, 5, 8], [0, 6, 2],
            [1, 0, 15], [1, 1, 32], [1, 2, 52], [1, 3, 40], [1, 4, 22], [1, 5, 6], [1, 6, 1],
            [2, 0, 18], [2, 1, 29], [2, 2, 60], [2, 3, 48], [2, 4, 25], [2, 5, 12], [2, 6, 4],
            [3, 0, 14], [3, 1, 30], [3, 2, 42], [3, 3, 35], [3, 4, 19], [3, 5, 5], [3, 6, 0],
            [4, 0, 8],  [4, 1, 16], [4, 2, 22], [4, 3, 18], [4, 4, 10], [4, 5, 2], [4, 6, 0]
        ]
        w2_spec = {
            "title": {"text": "Developer Commit Churn Heatmap", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
            "tooltip": {"position": "top"},
            "grid": {"left": "8%", "right": "8%", "bottom": "12%", "top": "18%", "containLabel": True},
            "xAxis": {"type": "category", "data": hours, "splitArea": {"show": True}},
            "yAxis": {"type": "category", "data": days, "splitArea": {"show": True}},
            "visualMap": {"min": 0, "max": 65, "calculable": True, "orient": "horizontal", "left": "center", "bottom": "0%", "inRange": {"color": ["#EADDFF", "#7F67BE", "#4F378B"]}},
            "series": [{"name": "Commits", "type": "heatmap", "data": heatmap_data, "label": {"show": True}}]
        }

        # Widget 3: Headless BI: Superset Revenue & Query Volume
        w3_spec = {
            "title": {"text": "Superset Headless BI: Revenue vs Latency", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
            "tooltip": {"trigger": "axis"},
            "grid": {"left": "3%", "right": "4%", "bottom": "10%", "top": "18%", "containLabel": True},
            "xAxis": {"type": "category", "boundaryGap": False, "data": ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6"]},
            "yAxis": [
                {"type": "value", "name": "Query Execs (k)", "position": "left"},
                {"type": "value", "name": "p95 Latency (ms)", "position": "right"}
            ],
            "series": [
                {
                    "name": "Queries Executed",
                    "type": "line",
                    "smooth": True,
                    "areaStyle": {"opacity": 0.2, "color": "#21005D"},
                    "itemStyle": {"color": "#6750A4"},
                    "data": [120, 142, 180, 210, 245, 290]
                },
                {
                    "name": "p95 Latency",
                    "type": "line",
                    "yAxisIndex": 1,
                    "itemStyle": {"color": "#006A6A"},
                    "data": [320, 310, 280, 290, 260, 240]
                }
            ]
        }

        # Widget 4: Code Review Bottlenecks by PR Size
        w4_spec = {
            "title": {"text": "Code Review Bottlenecks by PR Diff Size", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
            "tooltip": {"trigger": "item"},
            "legend": {"bottom": "0%", "left": "center"},
            "series": [
                {
                    "name": "Diff Size Distribution",
                    "type": "pie",
                    "radius": ["40%", "70%"],
                    "avoidLabelOverlap": False,
                    "itemStyle": {"borderRadius": 10, "borderColor": "#fff", "borderWidth": 2},
                    "data": [
                        {"value": 45, "name": "Small (< 100 lines)", "itemStyle": {"color": "#4A6572"}},
                        {"value": 30, "name": "Medium (100 - 400 lines)", "itemStyle": {"color": "#6750A4"}},
                        {"value": 18, "name": "Large (400 - 1000 lines)", "itemStyle": {"color": "#E8DEF8"}},
                        {"value": 7,  "name": "Massive (> 1000 lines)", "itemStyle": {"color": "#B3261E"}}
                    ]
                }
            ]
        }

        w1_spec["sql"] = "SELECT repo, count(*) as pr_count, round(avg(lines_added), 1) as avg_diff FROM github_commits GROUP BY 1 ORDER BY 1"
        w1_spec["archetype"] = "bar"
        w1_spec["filter_scope"] = "global"

        w2_spec["sql"] = "SELECT strftime(committed_at, '%H:00') as hour_slot, strftime(committed_at, '%a') as day_of_week, count(*) as commits FROM github_commits GROUP BY 1, 2 ORDER BY 1, 2"
        w2_spec["archetype"] = "heatmap"
        w2_spec["filter_scope"] = "global"

        w3_spec["sql"] = "SELECT database_name, latency_ms, cache_hit_pct FROM superset_query_performance ORDER BY latency_ms DESC"
        w3_spec["archetype"] = "dual_axis"
        w3_spec["filter_scope"] = "global"

        w4_spec["sql"] = "SELECT CASE WHEN (lines_added + lines_deleted) < 100 THEN 'Small (< 100 lines)' WHEN (lines_added + lines_deleted) < 400 THEN 'Medium (100 - 400 lines)' WHEN (lines_added + lines_deleted) < 1000 THEN 'Large (400 - 1000 lines)' ELSE 'Massive (> 1000 lines)' END as diff_tier, count(*) as count FROM github_commits GROUP BY 1 ORDER BY count DESC"
        w4_spec["archetype"] = "pie_donut"
        w4_spec["filter_scope"] = "global"

        w1 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="gh-pr-velocity",
            title="Weekly PR Velocity & SLA",
            widget_type="echarts",
            grid_json=json.dumps({"x": 0, "y": 0, "w": 6, "h": 5}),
            spec_json=json.dumps(w1_spec),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: /repos/main/pulls", "query": w1_spec["sql"]})
        )
        w2 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="gh-commit-heatmap",
            title="Developer Commit Heatmap",
            widget_type="echarts",
            grid_json=json.dumps({"x": 6, "y": 0, "w": 6, "h": 5}),
            spec_json=json.dumps(w2_spec),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: /repos/main/commits", "query": w2_spec["sql"]})
        )
        w3 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="superset-query-perf",
            title="Superset BI Headless Metrics",
            widget_type="echarts",
            grid_json=json.dumps({"x": 0, "y": 5, "w": 6, "h": 5}),
            spec_json=json.dumps(w3_spec),
            datasource_json=json.dumps({"type": "mcp_superset", "label": "Superset 7.0 MCP: query_performance", "query": w3_spec["sql"]})
        )
        w4 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="gh-pr-diff-breakdown",
            title="Code Review Diff Size Distribution",
            widget_type="echarts",
            grid_json=json.dumps({"x": 6, "y": 5, "w": 6, "h": 5}),
            spec_json=json.dumps(w4_spec),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: code_review_audit", "query": w4_spec["sql"]})
        )

        # Widget 5: Formatted Executive Code Review Audit Card
        w5_spec = {
            "type": "text_audit",
            "status": "🟢 PR SLAs On Track",
            "sla_status": "9.4h Turnaround vs 10h SLA",
            "findings": [
                {
                    "severity": "info",
                    "title": "PR Merge Velocity",
                    "detail": "76% of all pull requests merged within 6 hours of initial reviewer review."
                },
                {
                    "severity": "high",
                    "title": "High Risk PR #104",
                    "detail": "PR #104 touched 680 lines with potential session memory leak. Flagged for review."
                },
                {
                    "severity": "info",
                    "title": "Leading Code Reviewer",
                    "detail": "Sarah M. reviewed 28 PRs with median turnaround time of 3.2 hours."
                }
            ]
        }

        w5 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="gh-pr-executive-audit",
            title="Executive Code Review & SLA Audit",
            widget_type="text_audit",
            grid_json=json.dumps({"x": 0, "y": 10, "w": 12, "h": 4}),
            spec_json=json.dumps(w5_spec),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: /repos/main/reviews"})
        )

        db.add_all([w1, w2, w3, w4, w5])
        db.commit()

    # Seed Public Shared Dashboard created by colleague
    public_dashboard = db.query(Dashboard).filter(Dashboard.title == "Incident Reliability & SLA Cockpit").first()
    if not public_dashboard and colleague:
        pub_dash_id = str(uuid.uuid4())
        public_dashboard = Dashboard(
            id=pub_dash_id,
            user_id=colleague.id,
            title="Incident Reliability & SLA Cockpit",
            description="Org-wide production incident telemetry and SLA health metrics shared across engineering.",
            is_default=False,
            is_public=True
        )
        db.add(public_dashboard)
        db.commit()

        pub_w1 = DashboardWidget(
            dashboard_id=pub_dash_id,
            widget_id="pub-sla-health",
            title="Production Service Uptime (p99.9)",
            widget_type="echarts",
            grid_json=json.dumps({"x": 0, "y": 0, "w": 12, "h": 5}),
            spec_json=json.dumps({
                "title": {"text": "Production Uptime & Latency Distribution", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
                "tooltip": {"trigger": "axis"},
                "xAxis": {"type": "category", "data": ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"]},
                "yAxis": {"type": "value", "name": "Latency (ms)"},
                "series": [
                    {"name": "API Gateway", "type": "line", "smooth": True, "data": [42, 38, 55, 62, 48, 39]},
                    {"name": "Target SLA", "type": "line", "data": [80, 80, 80, 80, 80, 80], "lineStyle": {"type": "dashed", "color": "#FB7185"}}
                ]
            }),
            datasource_json=json.dumps({"type": "mcp_superset", "label": "Superset: /api/v1/chart/data"})
        )
        db.add(pub_w1)
        db.commit()

    # 4. Local Repositories Registry
    repos = db.query(LocalRepository).all()
    if not repos:
        r1 = LocalRepository(
            name="main-service",
            remote_url="https://github.com/company/main-service.git",
            local_path=str(REPOS_DIR / "main-service"),
            clone_type="full",
            default_branch="main"
        )
        r2 = LocalRepository(
            name="data-pipeline",
            remote_url="https://github.com/company/data-pipeline.git",
            local_path=str(REPOS_DIR / "data-pipeline"),
            clone_type="full",
            default_branch="main"
        )
        db.add_all([r1, r2])
        db.commit()
