import json
import uuid
from sqlalchemy.orm import Session
from backend.app.auth import hash_password
from backend.app.config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD
from backend.app.models import User, MCPConfig, Dashboard, DashboardWidget, AgentPersona, LocalRepository

def seed_database(db: Session):
    """Seed initial user, MCP tools, and default dynamic dashboard widgets if not present."""
    # 1. Admin user
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

    # 2. Global MCPs
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

        w1 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="gh-pr-velocity",
            title="Weekly PR Velocity & SLA",
            widget_type="echarts",
            grid_json=json.dumps({"x": 0, "y": 0, "w": 6, "h": 5}),
            spec_json=json.dumps(w1_spec),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: /repos/main/pulls"})
        )
        w2 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="gh-commit-heatmap",
            title="Developer Commit Heatmap",
            widget_type="echarts",
            grid_json=json.dumps({"x": 6, "y": 0, "w": 6, "h": 5}),
            spec_json=json.dumps(w2_spec),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: /repos/main/commits"})
        )
        w3 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="superset-query-perf",
            title="Superset BI Headless Metrics",
            widget_type="echarts",
            grid_json=json.dumps({"x": 0, "y": 5, "w": 6, "h": 5}),
            spec_json=json.dumps(w3_spec),
            datasource_json=json.dumps({"type": "mcp_superset", "label": "Superset 7.0 MCP: query_performance"})
        )
        w4 = DashboardWidget(
            dashboard_id=dash_id,
            widget_id="gh-pr-diff-breakdown",
            title="Code Review Diff Size Distribution",
            widget_type="echarts",
            grid_json=json.dumps({"x": 6, "y": 5, "w": 6, "h": 5}),
            spec_json=json.dumps(w4_spec),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: code_review_audit"})
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

    # Seed Full Potential Showcase Dashboard
    showcase_dash = db.query(Dashboard).filter(Dashboard.title == "Full Potential: React Apps & BI Showcase").first()
    if not showcase_dash and admin:
        sc_id = str(uuid.uuid4())
        showcase_dash = Dashboard(
            id=sc_id,
            user_id=admin.id,
            title="Full Potential: React Apps & BI Showcase",
            description="Demonstrating the canvas capabilities: Stateful React micro-frontends, D3-style SVG DAGs, DuckDB tables, and ECharts side-by-side.",
            is_default=False,
            is_public=True
        )
        db.add(showcase_dash)
        db.commit()

        # Widget 1: Interactive Git Branch & Topology DAG Visualizer (React App)
        sc_w1 = DashboardWidget(
            dashboard_id=sc_id,
            widget_id="react-git-dag",
            title="Interactive Git Branch DAG & Cherry-Pick",
            widget_type="react_app",
            grid_json=json.dumps({"x": 0, "y": 0, "w": 6, "h": 5}),
            spec_json=json.dumps({
                "type": "git_topology",
                "app_name": "Git DAG Visualizer",
                "component_path": "src/widgets/GitDAG.tsx",
                "description": "Interactive SVG commit graph with branch switching and one-click cherry-pick automation."
            }),
            datasource_json=json.dumps({"type": "local_repo", "label": "Local Git Repo: main-service"})
        )

        # Widget 2: Kubernetes Multi-Cluster Canary Traffic Shaper (React App)
        sc_w2 = DashboardWidget(
            dashboard_id=sc_id,
            widget_id="react-canary-shaper",
            title="Canary Traffic Shaper & Rollout Controller",
            widget_type="react_app",
            grid_json=json.dumps({"x": 6, "y": 0, "w": 6, "h": 5}),
            spec_json=json.dumps({
                "type": "pipeline_runner",
                "app_name": "Canary Traffic Shaper",
                "component_path": "src/widgets/CanaryShaper.tsx",
                "description": "Interactive traffic shaping slider with live multi-region cluster health telemetry."
            }),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: CI/CD Pipeline"})
        )

        # Widget 3: Live SRE Incident Severity & On-Call Matrix (React App)
        sc_w3 = DashboardWidget(
            dashboard_id=sc_id,
            widget_id="react-incident-matrix",
            title="Live SRE Incident Severity & On-Call Matrix",
            widget_type="react_app",
            grid_json=json.dumps({"x": 0, "y": 5, "w": 6, "h": 5}),
            spec_json=json.dumps({
                "type": "incident_matrix",
                "app_name": "Incident Matrix",
                "component_path": "src/widgets/IncidentMatrix.tsx",
                "description": "Real-time P1/P2 alert triage with on-call shift countdown and automated page dispatch."
            }),
            datasource_json=json.dumps({"type": "mcp_github", "label": "PagerDuty / SRE MCP"})
        )

        # Widget 4: Superset Headless BI Revenue vs Latency (ECharts)
        w3_spec_data = {
            "title": {"text": "Superset Headless BI: Revenue vs Latency", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
            "tooltip": {"trigger": "axis"},
            "grid": {"left": "3%", "right": "4%", "bottom": "10%", "top": "18%", "containLabel": True},
            "xAxis": {"type": "category", "boundaryGap": False, "data": ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6"]},
            "yAxis": [
                {"type": "value", "name": "Query Execs (k)", "position": "left"},
                {"type": "value", "name": "p95 Latency (ms)", "position": "right"}
            ],
            "series": [
                {"name": "Queries Executed", "type": "line", "smooth": True, "areaStyle": {"opacity": 0.2, "color": "#21005D"}, "itemStyle": {"color": "#6750A4"}, "data": [120, 142, 180, 210, 245, 290]},
                {"name": "p95 Latency", "type": "line", "yAxisIndex": 1, "itemStyle": {"color": "#006A6A"}, "data": [320, 310, 280, 290, 260, 240]}
            ]
        }
        sc_w4 = DashboardWidget(
            dashboard_id=sc_id,
            widget_id="sc-superset-revenue",
            title="Superset Headless BI: Revenue vs Latency",
            widget_type="echarts",
            grid_json=json.dumps({"x": 6, "y": 5, "w": 6, "h": 5}),
            spec_json=json.dumps(w3_spec_data),
            datasource_json=json.dumps({"type": "mcp_superset", "label": "Superset 7.0 MCP: query_performance"})
        )

        # Widget 5: In-Process DuckDB Query Telemetry Table (Table)
        sc_w5 = DashboardWidget(
            dashboard_id=sc_id,
            widget_id="sc-duckdb-table",
            title="Engine Query Performance & Latency Matrix",
            widget_type="table",
            grid_json=json.dumps({"x": 0, "y": 10, "w": 6, "h": 5}),
            spec_json=json.dumps({
                "type": "table",
                "columns": ["Engine", "Type", "Latency (ms)", "Cache Hit"],
                "rows": [
                    {"Engine": "DuckDB In-Memory", "Type": "In-Process", "Latency (ms)": 18.4, "Cache Hit": "99.8%"},
                    {"Engine": "ClickHouse Live", "Type": "Columnar", "Latency (ms)": 64.1, "Cache Hit": "97.4%"},
                    {"Engine": "Postgres Primary", "Type": "OLTP", "Latency (ms)": 142.5, "Cache Hit": "98.2%"},
                    {"Engine": "Snowflake DW", "Type": "OLAP", "Latency (ms)": 480.2, "Cache Hit": "89.5%"}
                ]
            }),
            datasource_json=json.dumps({"type": "duckdb", "label": "DuckDB In-Process Engine"})
        )

        # Widget 6: Weekly PR Turnaround & Merge Velocity (ECharts)
        w1_spec_data = {
            "title": {"text": "Weekly PR Turnaround & Merge Velocity", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
            "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
            "grid": {"left": "3%", "right": "4%", "bottom": "10%", "top": "18%", "containLabel": True},
            "xAxis": {"type": "category", "data": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]},
            "yAxis": {"type": "value", "name": "Hours to Merge"},
            "series": [
                {"name": "Avg Review Time", "type": "bar", "data": [14.2, 8.5, 22.1, 6.4, 12.0, 3.2, 2.1], "itemStyle": {"color": "#6750A4", "borderRadius": [8, 8, 0, 0]}},
                {"name": "Target SLA", "type": "line", "data": [10, 10, 10, 10, 10, 10, 10], "itemStyle": {"color": "#B3261E"}, "lineStyle": {"type": "dashed"}}
            ]
        }
        sc_w6 = DashboardWidget(
            dashboard_id=sc_id,
            widget_id="sc-pr-velocity",
            title="Weekly PR Turnaround & Merge Velocity",
            widget_type="echarts",
            grid_json=json.dumps({"x": 6, "y": 10, "w": 6, "h": 5}),
            spec_json=json.dumps(w1_spec_data),
            datasource_json=json.dumps({"type": "mcp_github", "label": "GitHub MCP: /repos/main/pulls"})
        )

        # Widget 7: Architecture Brief (Markdown)
        sc_w7 = DashboardWidget(
            dashboard_id=sc_id,
            widget_id="sc-architecture-brief",
            title="Architecture Brief: Hybrid Canvas & React Micro-Frontends",
            widget_type="text_audit",
            grid_json=json.dumps({"x": 0, "y": 15, "w": 12, "h": 4}),
            spec_json=json.dumps({
                "type": "text_audit",
                "status": "⚛️ React App Architecture",
                "sla_status": "Preset Agora Extensible Standard",
                "findings": [
                    {
                        "severity": "info",
                        "title": "Stateful React Micro-Frontends",
                        "detail": "Widgets are not limited to static SVG/Canvas charts. They host full React components with local hooks, sliders, buttons, and API calls."
                    },
                    {
                        "severity": "info",
                        "title": "Custom Visualizations & D3",
                        "detail": "Developers can implement custom SVGs, force-directed graphs, or Sankey flows tailored to internal business domain models."
                    },
                    {
                        "severity": "info",
                        "title": "Unified Data Substrate",
                        "detail": "Both ECharts and React App widgets connect to the same DuckDB in-memory cache and Superset Headless BI engine."
                    }
                ]
            }),
            datasource_json=json.dumps({"type": "local_repo", "label": "Antigravity Studio Spec"})
        )

        db.add_all([sc_w1, sc_w2, sc_w3, sc_w4, sc_w5, sc_w6, sc_w7])
        db.commit()

    # 4. Agent Personas
    personas = db.query(AgentPersona).all()
    if not personas:
        github_agent = AgentPersona(
            id="github-agent",
            name="GitHub Intelligence Agent",
            role_description="Specialist in PR code reviews, developer velocity, commit churn heatmaps, and repository audits.",
            icon="git-pull-request",
            is_default=True,
            system_instructions=(
                "You are the GitHub Engineering & Code Review Specialist.\n\n"
                "Key Responsibilities:\n"
                "1. Audit GitHub pull requests, review turnaround times, and enforce the 10-hour SLA target.\n"
                "2. Conduct deep code reviews on repositories (`main-service`, `data-pipeline`). Verify that database operations use parameterized queries.\n"
                "3. Analyze commit churn and peak developer velocity using local git logs and GitHub MCP.\n"
                "4. When a critical bug or vulnerability is identified, ONLY create or update a Jira ticket if the user explicitly asks for it AND Jira MCP is connected.\n"
                "5. Emit high-contrast, informative ECharts visualization widgets onto the dashboard canvas."
            )
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
        db.add_all([github_agent, superset_agent])
        db.commit()

    # 5. Local Repositories Registry
    repos = db.query(LocalRepository).all()
    if not repos:
        r1 = LocalRepository(
            name="main-service",
            remote_url="https://github.com/company/main-service.git",
            local_path="/local_data/repos/main-service",
            clone_type="full",
            default_branch="main"
        )
        r2 = LocalRepository(
            name="data-pipeline",
            remote_url="https://github.com/company/data-pipeline.git",
            local_path="/local_data/repos/data-pipeline",
            clone_type="full",
            default_branch="main"
        )
        db.add_all([r1, r2])
        db.commit()
