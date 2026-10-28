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
    """Discovers real cloned repositories in REPOS_DIR, registers them, and removes obsolete mock artifacts."""
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

        # Remove legacy mock dashboards by title
        legacy_titles = ["Engineering & BI Intelligence Studio", "Incident Reliability & SLA Cockpit"]
        legacy_dashboards = db.query(Dashboard).filter(Dashboard.title.in_(legacy_titles)).all()
        for ld in legacy_dashboards:
            db.query(DashboardComment).filter(DashboardComment.dashboard_id == ld.id).delete(synchronize_session=False)
            db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == ld.id).delete(synchronize_session=False)
            db.delete(ld)

        # Remove legacy widgets querying non-existent tables
        bad_widgets = db.query(DashboardWidget).filter(
            (DashboardWidget.spec_json.like("%github_commits%")) |
            (DashboardWidget.spec_json.like("%superset_query_performance%")) |
            (DashboardWidget.datasource_json.like("%github_commits%")) |
            (DashboardWidget.datasource_json.like("%superset_query_performance%"))
        ).all()
        for bw in bad_widgets:
            db.delete(bw)

        # Remove mock MCP configs with dummy localhost / internal URLs
        db.query(MCPConfig).filter(
            (MCPConfig.url.like("%.internal%")) |
            (MCPConfig.url.like("%localhost:8088%")) |
            (MCPConfig.url.like("%localhost:9000%")) |
            (MCPConfig.url.like("%localhost:8080%")) |
            (MCPConfig.url.like("%localhost:3000%"))
        ).delete(synchronize_session=False)

        # Clean up legacy mock colleague demo user
        db.query(User).filter(User.email == "sarah.lead@antigravity.io").delete(synchronize_session=False)
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
    """Seed initial user, agent personas, and discover real repositories."""
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

    # 2. Agent Personas
    github_persona_instructions = (
        "You are the GitHub Engineering & Codebase Intelligence Specialist.\n\n"
        "Key Responsibilities:\n"
        "1. Dynamically inspect cloned GitHub repositories on disk (`local_data/repos/`) based on the user's exact request—including features/routes/components and who authored them, codebase issues/TODOs/FIXMEs and bugfix commits with authors, module ownership, AST complexity, or commit velocity.\n"
        "2. Do NOT assume fixed `github_commits` or `github_contributors` tables exist. Instead, use `extract_repository_dataset_records` or `propose_duckdb_dataset(table_name=..., description=..., records=[...])` to dynamically propose custom DuckDB tables tailored to the data needed.\n"
        "3. Communicate recommendations and architectural questions with `ask_user_confirmation` to give users clickable choice buttons directly in chat.\n"
        "4. Emit clear, data-backed Apache ECharts visualization widgets (`upsert_chart_widget`) and engineering reports (`create_markdown_report_widget`) onto the dashboard canvas without repeating boilerplate text."
    )
    superset_persona_instructions = (
        "You are the Superset Headless BI & Data Analytics Specialist.\n\n"
        "Key Responsibilities:\n"
        "1. Connect directly to Superset backend endpoints (`/api/v1/chart/data` and `/api/v1/sqllab/execute/`) via Superset MCP, completely skipping the Superset frontend.\n"
        "2. Use the Data Catalog MCP to discover semantic tables, column schemas, and metrics glossary dynamically.\n"
        "3. Formulate SQL slice queries to aggregate revenue, transaction volumes, user metrics, and query performance.\n"
        "4. Project dynamic, interactive ECharts widgets directly onto the canvas with clear legends, axes, and responsive tooltips."
    )
    correlation_persona_instructions = (
        "You are the Engineering Impact & Cross-Domain Correlation Specialist.\n\n"
        "Key Responsibilities:\n"
        "1. Connect software engineering activity (PR review turnaround, commit churn, diff bottlenecks) with operational and business KPIs (database query latency, system errors, ARR growth).\n"
        "2. Query dynamically extracted GitHub datasets created via `extract_repository_dataset_records` or `propose_duckdb_dataset` alongside Superset Headless BI metrics to discover causal relationships.\n"
        "3. Emit dual-axis Apache ECharts visualizations (e.g. Commit Churn on left bar axis vs P95 Query Latency on right line axis) so engineering leaders immediately see the business impact of architectural work.\n"
        "4. When code changes reduce latencies or improve cache hit ratios, synthesize an impact audit card quantifying the engineering ROI."
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
            system_instructions=superset_persona_instructions,
        )
        correlation_agent = AgentPersona(
            id="correlation-agent",
            name="Engineering Impact & ROI Agent",
            role_description="Correlates GitHub commit velocity, PR sizes, and SLA turnaround with Superset query latencies, API reliability, and business ARR.",
            icon="git-merge",
            is_default=False,
            system_instructions=correlation_persona_instructions,
        )
        db.add_all([github_agent, superset_agent, correlation_agent])
        db.commit()
    else:
        gh_p = db.query(AgentPersona).filter(AgentPersona.id == "github-agent").first()
        if gh_p and ("github_commits" in (gh_p.system_instructions or "") or "extract_repository_dataset_records" not in (gh_p.system_instructions or "")):
            gh_p.system_instructions = github_persona_instructions
            gh_p.role_description = "Specialist in codebase feature authorship, issue/tech-debt discovery, dynamic dataset creation, and repository analytics."
        sup_p = db.query(AgentPersona).filter(AgentPersona.id == "superset-agent").first()
        if sup_p and ("customer_transactions_daily" in (sup_p.system_instructions or "") or "analytics." in (sup_p.system_instructions or "")):
            sup_p.system_instructions = superset_persona_instructions
        corr = db.query(AgentPersona).filter(AgentPersona.id == "correlation-agent").first()
        if not corr:
            correlation_agent = AgentPersona(
                id="correlation-agent",
                name="Engineering Impact & ROI Agent",
                role_description="Correlates GitHub commit velocity, PR sizes, and SLA turnaround with Superset query latencies, API reliability, and business ARR.",
                icon="git-merge",
                is_default=False,
                system_instructions=correlation_persona_instructions,
            )
            db.add(correlation_agent)
        elif "github_commits" in (corr.system_instructions or "") or "engineering_impact_daily" in (corr.system_instructions or "") or "superset_query_performance" in (corr.system_instructions or ""):
            corr.system_instructions = correlation_persona_instructions
        db.commit()

    # Discover and sync real cloned repositories and clean obsolete artifacts
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
