import ast
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from backend.app.config import REPOS_DIR
from backend.app.services.duckdb_service import duckdb_service
from backend.app.services.git_service import git_service
from backend.app.schemas.canvas_contracts import (
    compile_widget_spec,
    build_single_filter_widget,
)

logger = logging.getLogger("agent_tools")

CONTEXT_FILE = Path(__file__).resolve().parent.parent.parent.parent / "AGENT_CONTEXT.md"


def load_agent_context() -> str:
    """Reads persistent agent context and domain guidelines from AGENT_CONTEXT.md."""
    if CONTEXT_FILE.exists():
        try:
            return CONTEXT_FILE.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to read agent context file: {e}")
    return ""


def safe_extract_title(spec: dict[str, Any], default: str = "Repository Metric Chart") -> str:
    """Safely extracts title string from an Apache ECharts specification."""
    raw = spec.get("title")
    if isinstance(raw, dict):
        return raw.get("text") or default
    if isinstance(raw, list) and len(raw) > 0:
        first = raw[0]
        if isinstance(first, dict):
            return first.get("text") or default
        return str(first)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return default


def resolve_local_repo_path(repo_name_or_path: str) -> Path:
    """Resolves a repository name or path inside REPOS_DIR safely without path traversal."""
    clean_name = Path(repo_name_or_path).name.strip() if repo_name_or_path else ""
    if clean_name:
        direct = REPOS_DIR / clean_name
        if direct.exists() and git_service.is_repo_cloned(str(direct)):
            return direct
        with_git = REPOS_DIR / f"{clean_name}.git"
        if with_git.exists() and git_service.is_repo_cloned(str(with_git)):
            return with_git
        if REPOS_DIR.exists():
            for candidate in REPOS_DIR.iterdir():
                if candidate.is_dir() and git_service.is_repo_cloned(str(candidate)) and (
                    clean_name.lower() in candidate.name.lower()
                    or candidate.name.lower().replace(".git", "") == clean_name.lower()
                ):
                    return candidate

    # Fallback: if a single repository is cloned in REPOS_DIR or a generic alias was passed, resolve to it
    if REPOS_DIR.exists():
        cloned_dirs = [
            p for p in sorted(REPOS_DIR.iterdir())
            if p.is_dir() and git_service.is_repo_cloned(str(p))
        ]
        if len(cloned_dirs) == 1:
            return cloned_dirs[0]
        if cloned_dirs and clean_name.lower() in ("", "default", "current", "repo", "repository", "main"):
            return cloned_dirs[0]

    return REPOS_DIR / (clean_name or "repo")


def get_catalog_context_summary() -> str:
    """Builds a live summary of cloned repositories and DuckDB datasets for the agent system prompt."""
    lines = ["[LIVE REPOSITORY & DUCKDB CATALOG]"]
    try:
        from backend.app.database import SessionLocal
        from backend.app.models import LocalRepository
        with SessionLocal() as db:
            repos = db.query(LocalRepository).all()
            if repos:
                lines.append("Registered Cloned Repositories:")
                for r in repos:
                    cloned = git_service.is_repo_cloned(r.local_path)
                    lines.append(
                        f"- `{r.name}` | branch: `{r.default_branch}` | path: `{r.local_path}` | cloned: {cloned}"
                    )
            else:
                lines.append("Registered Cloned Repositories: None registered yet.")
    except Exception as e:
        logger.debug(f"Error listing repositories for context: {e}")

    try:
        datasets = duckdb_service.list_datasets()
        if datasets:
            lines.append("\nAvailable DuckDB Analytical Tables:")
            for ds in datasets:
                raw_cols = ds.get("columns", [])
                cols = ", ".join(c if isinstance(c, str) else c.get("name", "") for c in raw_cols)
                lines.append(
                    f"- `{ds['table_name']}` ({ds['row_count']} rows, type={ds.get('dataset_type', 'table')}) | columns: [{cols}]"
                )
    except Exception as e:
        logger.warning(f"Error listing DuckDB datasets for context: {e}")

    return "\n".join(lines)


def get_dashboard_context(
    dashboard_id: str | None = None
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Fetches real-time dashboard canvas context:
    - Existing widgets on the active dashboard canvas
    - Open/unresolved spatial comment pins and targeted instructions
    - Bound data sources explicitly selected for this dashboard
    """
    if not dashboard_id:
        return "", [], [], []

    try:
        from backend.app.database import SessionLocal
        from backend.app.models import Dashboard, DashboardWidget, DashboardComment
        with SessionLocal() as db:
            d = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
            if not d:
                return "", [], [], []

            widgets = db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == d.id).all()
            comments = db.query(DashboardComment).filter(DashboardComment.dashboard_id == d.id).all()
            bound_sources = json.loads(d.datasources_json) if d.datasources_json else []

            w_dicts: list[dict[str, Any]] = []
            for w in widgets:
                try:
                    spec = json.loads(w.spec_json) if w.spec_json else {}
                except Exception:
                    spec = {}
                try:
                    grid = json.loads(w.grid_json) if w.grid_json else {}
                except Exception:
                    grid = {}
                w_dicts.append({
                    "id": w.widget_id,
                    "title": w.title,
                    "widget_type": w.widget_type,
                    "grid": grid,
                    "spec": spec,
                })

            c_dicts: list[dict[str, Any]] = []
            for c in comments:
                target_widget = next((w for w in w_dicts if w["id"] == c.widget_id), None)
                target_title = target_widget["title"] if target_widget else "Canvas Area"
                replies = []
                if getattr(c, "replies_json", None):
                    try:
                        replies = json.loads(c.replies_json)
                    except Exception:
                        replies = []
                c_dicts.append({
                    "id": c.id,
                    "widget_id": c.widget_id,
                    "widget_title": target_title,
                    "user_email": c.user_email,
                    "content": c.content,
                    "replies": replies,
                    "pos_x": c.pos_x,
                    "pos_y": c.pos_y,
                    "is_resolved": c.is_resolved,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                })

            lines = [
                "[ACTIVE DASHBOARD CANVAS CONTEXT]",
                f"Dashboard ID: `{d.id}` | Title: \"{d.title}\"",
                f"Active Canvas Widgets ({len(w_dicts)}):",
            ]
            for w in w_dicts:
                grid = w.get("grid") or {}
                grid_info = (
                    f" | Grid: col={grid.get('x', 0)}, row={grid.get('y', 0)}, size={grid.get('w', 6)}x{grid.get('h', 5)}"
                    if grid else ""
                )
                lines.append(f"- ID: `{w['id']}` | Title: \"{w['title']}\" | Type: {w['widget_type']}{grid_info}")

            if bound_sources:
                lines.append(f"\n[BOUND DATA SOURCES FOR THIS DASHBOARD] ({len(bound_sources)} sources):")
                lines.append("STRICT CONTEXT BOUNDARY: Prioritize these bound sources when analyzing metrics and creating widgets:")
                for s in bound_sources:
                    lines.append(f"- [{s.get('type', 'source').upper()}]: {s.get('label', s.get('id', 'source'))}")

            unresolved = [c for c in c_dicts if not c["is_resolved"]]
            if unresolved:
                lines.append(f"\nUnresolved Spatial Pin Comments ({len(unresolved)}):")
                for c in unresolved:
                    lines.append(
                        f"- Pin #{c['id']} on [{c['widget_title']}] (`{c['widget_id']}`): \"{c['content']}\""
                    )

            return "\n".join(lines), w_dicts, c_dicts, bound_sources
    except Exception as e:
        logger.warning(f"Error fetching dashboard context: {e}")
        return "", [], [], []


def resolve_persona_instructions(agent_id: str | None = None) -> tuple[str, str]:
    """
    Resolves agent persona instructions and name using Agor's layered default walk:
    1. Look up explicit `agent_id` in database
    2. If not found or `agent_id` is "general" / empty, look up `is_default=True` persona (e.g. GitHub Intelligence Agent)
    3. Fallback to first persona in DB or general engineering assistant
    """
    try:
        from backend.app.database import SessionLocal
        from backend.app.models import AgentPersona
        with SessionLocal() as db:
            if agent_id and agent_id != "general":
                p = db.query(AgentPersona).filter(AgentPersona.id == agent_id).first()
                if p:
                    return p.name, p.system_instructions

            # Default persona fallback (e.g. GitHub Intelligence Agent)
            default_p = db.query(AgentPersona).filter(AgentPersona.is_default == True).first()
            if default_p:
                return default_p.name, default_p.system_instructions

            first_p = db.query(AgentPersona).first()
            if first_p:
                return first_p.name, first_p.system_instructions
    except Exception as e:
        logger.debug(f"Could not resolve persona instructions: {e}")

    return "General Engineering Agent", (
        "You are the Engineering & Git Analytics Assistant. "
        "Analyze git repositories, query DuckDB, propose derived datasets with user confirmation, "
        "and mount interactive ECharts visualizations on the canvas."
    )


def build_layered_system_prompt(
    agent_id: str | None = None,
    dashboard_id: str | None = None,
    scope: str | None = None,
    pin_id: int | None = None,
    widget_id: str | None = None,
    history_context: str = "",
    parent_context: str = "",
    parent_session_id: str | None = None,
) -> str:
    """
    Constructs the canonical multi-layer system prompt matching Agor's robust context architecture:
    Layer 1: Static Core Execution & Tool Identity (Capabilities, 4-step GitHub analysis pipeline, tool schema, proposal rules)
    Layer 2: Domain Context (AGENT_CONTEXT.md - metrics definitions, commit schemas, visualization palette)
    Layer 3: Resolved Persona (Resolved via explicit ID -> default persona fallback)
    Layer 4: Dashboard & Bound Datasource Boundary (Title, Description/Goal, Bound Data Sources, Active Canvas Widgets)
    Layer 5: Localized Spatial Pin / Widget Context (if prompt originates from a pin or widget drawer)
    Layer 6: Sub-task Context (if branched from a main dashboard thread)
    """
    persona_name, persona_instructions = resolve_persona_instructions(agent_id)
    domain_context = load_agent_context()
    catalog_summary = get_catalog_context_summary()
    dash_context, active_widgets, active_comments, bound_sources = get_dashboard_context(dashboard_id)

    pin_context = ""
    if pin_id:
        target_comment = next((c for c in active_comments if c["id"] == pin_id), None)
        if target_comment:
            pin_context = (
                f"\n[LOCALIZED SPATIAL PIN #{pin_id} FOCUS]\n"
                f"Target Widget: \"{target_comment.get('widget_title', 'Canvas Area')}\" (`{target_comment.get('widget_id')}`)\n"
                f"User Pin Note: \"{target_comment.get('content')}\"\n"
                f"Instructions: Tailor your response directly to resolve this user pin instruction."
            )
    elif widget_id:
        target_w = next((w for w in active_widgets if w["id"] == widget_id), None)
        if target_w:
            pin_context = (
                f"\n[TARGET WIDGET CONTEXT]\n"
                f"Widget ID: `{target_w.get('id')}` | Title: \"{target_w.get('title')}\"\n"
                f"Type: {target_w.get('widget_type')}\n"
                f"Instructions: You are in a localized conversation focusing on this specific widget."
            )

    parent_thread_layer = ""
    if parent_context:
        parent_thread_layer = (
            f"\n[PARENT DASHBOARD CHAT (SUB-TASK BRANCH)]\n"
            f"This conversation is a specialized sub-task/subprocess branching from the main dashboard conversation "
            f"(Session `{parent_session_id or 'parent'}`).\n"
            f"Recent discussion from the main thread:\n"
            f"{parent_context}\n"
            f"Instructions: Inherit the findings, datasets, and context from the main thread above. Coordinate your analysis seamlessly with the parent thread."
        )

    core_rules = (
        "## Agent Capabilities & Execution Rules:\n"
        "1. Dynamic Git & Codebase Extraction: There are NO pre-baked telemetry tables (`github_commits` or `github_contributors`) unless explicitly created. Instead, use `extract_repository_dataset_records` to dynamically extract structured records tailored to the user's requirement (e.g., `mode='features_and_modules'` for features/components/routes and who authored them, `mode='issues_todos_and_fixes'` for code TODOs/FIXMEs and bugfix commits with authors, `mode='file_ownership_and_churn'` for module/file ownership, or `mode='git_search'` for custom git history queries).\n"
        "2. Deep Codebase Intelligence (Autonomous Read): Use `list_repository_files`, `search_repository_code`, `read_repository_file`, `analyze_code_complexity`, and `analyze_git_repository` to inspect source code, AST complexity, and repository history.\n"
        "3. Dynamic Schema-Free Dataset Proposals: You can propose ANY custom DuckDB table schema based on the user's request! Call `propose_duckdb_dataset(table_name=..., description=..., records=[...])` (or pass `propose_table_name` directly to `extract_repository_dataset_records`, or pass a `sql_query` transforming an existing table). The user will see an interactive confirmation card with schema, row count, and sample rows to Approve & Create.\n"
        "4. Critical Gated Operations (Approval Required): Always call `propose_file_edit` before modifying code files, and `propose_repository_command` before running shell commands.\n"
        "5. Interactive Recommendations & Questions: When you have recommendations or design questions, call `ask_user_confirmation` to present interactive choice buttons directly to the user.\n"
        "6. Safe Chart Updates (Permission Required): Never silently replace or overwrite existing canvas charts! If updating an existing chart (`widget_id`), `upsert_chart_widget` will automatically present an approval request with options ('Approve: Update', 'Add as New Chart Instead', 'Decline'). Only pass `user_confirmed=True` when the user has explicitly confirmed replacing the chart. To add a new chart alongside existing ones, leave `widget_id` empty.\n"
        "7. Canvas Visualizations & Reports: Use `upsert_chart_widget` (supporting either `sql_query` against any DuckDB/staged dataset OR `data_records` directly!) and `create_markdown_report_widget` to mount interactive Apache ECharts visualizations and engineering reports onto the active dashboard canvas.\n"
        "8. High Signal & No Hallucination: Keep chat responses concise, well-structured, and free of repeated boilerplate text. Never fabricate metrics or repository names."
    )

    layers = [
        f"You are the **{persona_name}**.",
        f"### Persona Instructions:\n{persona_instructions}",
        f"### Domain Context & Engineering Intelligence:\n{domain_context}" if domain_context else "",
        f"### Available Local Repositories & Data Catalog:\n{catalog_summary}" if catalog_summary else "",
        dash_context,
        pin_context,
        parent_thread_layer,
        history_context,
        core_rules,
    ]

    return "\n\n".join(layer for layer in layers if layer.strip())


def persist_widget_to_dashboard(
    dashboard_id: str | None,
    widget_payload: dict[str, Any],
    resolve_comments_on_update: bool = False
) -> bool:
    """Persists or updates a widget on the target dashboard in SQLite."""
    if not dashboard_id:
        return False
    try:
        from backend.app.database import SessionLocal
        from backend.app.models import DashboardWidget, DashboardComment
        with SessionLocal() as db:
            w_id = widget_payload["id"]
            existing = (
                db.query(DashboardWidget)
                .filter(
                    DashboardWidget.dashboard_id == dashboard_id,
                    DashboardWidget.widget_id == w_id,
                )
                .first()
            )
            if existing:
                existing.title = widget_payload.get("title", existing.title)
                existing.widget_type = widget_payload.get("widget_type", existing.widget_type)
                existing.spec_json = json.dumps(widget_payload.get("spec", {}))
                if widget_payload.get("grid"):
                    existing.grid_json = json.dumps(widget_payload["grid"])
                if widget_payload.get("datasource"):
                    existing.datasource_json = json.dumps(widget_payload["datasource"])
                is_update = True
            else:
                db.add(
                    DashboardWidget(
                        dashboard_id=dashboard_id,
                        widget_id=w_id,
                        title=widget_payload.get("title", "Analytics Widget"),
                        widget_type=widget_payload.get("widget_type", "echarts"),
                        grid_json=json.dumps(widget_payload.get("grid", {"x": 0, "y": 0, "w": 6, "h": 5})),
                        spec_json=json.dumps(widget_payload.get("spec", {})),
                        datasource_json=json.dumps(widget_payload.get("datasource", {"type": "duckdb"})),
                    )
                )
                is_update = False

            if resolve_comments_on_update and is_update:
                for c in (
                    db.query(DashboardComment)
                    .filter(
                        DashboardComment.dashboard_id == dashboard_id,
                        DashboardComment.widget_id == w_id,
                        DashboardComment.is_resolved == False,
                    )
                    .all()
                ):
                    c.is_resolved = True

            db.commit()
            return is_update
    except Exception as e:
        logger.warning(f"Failed to persist widget to dashboard {dashboard_id}: {e}")
        return False


def build_agent_tools(
    current_dashboard_id: str | None,
    emitted_canvas_actions: list[dict[str, Any]],
    emitted_proposals: list[dict[str, Any]] | None = None,
) -> list[Callable[..., Any]]:
    """
    Constructs the suite of Python tool functions for the 4-step GitHub analysis pipeline:
    1. Inspect & sync repositories / branches
    2. Analyze repository commits, conventional commit breakdown, churn, and contributors
    3. Query DuckDB & materialize derived local DuckDB datasets
    4. Create/update interactive ECharts widgets and Markdown report cards on the canvas
    """

    def list_repositories_and_datasets() -> dict[str, Any]:
        """Lists all cloned GitHub repositories on disk and all DuckDB analytical tables with schemas."""
        repos_list = []
        try:
            from backend.app.database import SessionLocal
            from backend.app.models import LocalRepository
            with SessionLocal() as db:
                for r in db.query(LocalRepository).all():
                    repos_list.append({
                        "name": r.name,
                        "remote_url": r.remote_url,
                        "local_path": r.local_path,
                        "default_branch": r.default_branch,
                        "is_cloned": git_service.is_repo_cloned(r.local_path),
                    })
        except Exception as e:
            logger.warning(f"Error listing repositories in tool: {e}")

        return {
            "repositories": repos_list,
            "duckdb_datasets": duckdb_service.list_datasets(),
        }

    def list_git_branches(repo: str) -> dict[str, Any]:
        """Lists available branches and the active branch for a cloned local GitHub repository."""
        target_path = resolve_local_repo_path(repo)
        return git_service.get_repository_branches(str(target_path))

    def analyze_git_repository(repo: str, branch: str = "", limit: int = 1000) -> dict[str, Any]:
        """
        Analyzes a cloned Git repository's commit log, contributor leaderboard, conventional commit types
        (feat, fix, refactor, perf, chore, docs, test), module churn, file extensions, and daily commit velocity.
        """
        target_path = resolve_local_repo_path(repo)
        return git_service.analyze_repository_commits(str(target_path), branch=branch, limit=limit)

    def extract_repository_dataset_records(
        repo: str,
        extraction_mode: str = "features_and_modules",
        path_filter: str = "",
        search_pattern: str = "",
        limit: int = 150,
        propose_table_name: str = "",
        description: str = "",
    ) -> dict[str, Any]:
        """
        Dynamically extracts structured dataset records from a cloned repository based on what the user needs.
        Supported `extraction_mode` values:
        - 'features_and_modules': List of features, API routes, UI components, classes, and modules along with who authored them (`primary_author`, `last_author`, `contributor_count`, `commits_on_file`, `file_loc`, `last_modified`).
        - 'issues_todos_and_fixes': List of codebase issues/tech-debt markers (TODO, FIXME, BUG, HACK) and bugfix/issue commits along with who authored them (`author`, `date`, `issue_kind`, `tag`, `summary`, `module`, `file_path`, `reference`).
        - 'file_ownership_and_churn': Per-file and per-module authorship, contributor count, commit count, lines added/deleted, and total churn.
        - 'git_search': Custom git log/diff search filtered by `search_pattern` and/or `path_filter`.
        If `propose_table_name` is provided, automatically stages the extracted records and emits an interactive dataset creation proposal card for the user!
        """
        target_path = resolve_local_repo_path(repo)
        res = git_service.extract_custom_repository_records(
            str(target_path),
            mode=extraction_mode,
            path_filter=path_filter,
            search_pattern=search_pattern,
            limit=limit,
        )
        records = res.get("records", [])
        proposal_info = None
        if propose_table_name and records:
            prop_res = propose_duckdb_dataset(
                table_name=propose_table_name,
                description=description or f"Dynamic {extraction_mode} dataset extracted from repository '{res.get('repo', repo)}'",
                records=records,
                rationale=f"Extracted {len(records)} structured records ({extraction_mode}) from '{res.get('repo', repo)}'",
            )
            proposal_info = prop_res

        return {
            "repo": res.get("repo", repo),
            "extraction_mode": extraction_mode,
            "row_count": len(records),
            "columns": res.get("columns", []),
            "sample_records": records[:25],
            "staged_table_name": proposal_info.get("table_name") if proposal_info else None,
            "proposal": proposal_info,
        }

    def query_duckdb(query: str) -> dict[str, Any]:
        """Executes a read-only analytical SQL query against DuckDB user/agent-created tables (or staged proposal tables)."""
        try:
            return duckdb_service.execute_query(query)
        except Exception as e:
            return {"error": str(e), "sql": query}

    def propose_duckdb_dataset(
        table_name: str,
        description: str = "",
        sql_query: str = "",
        records: list[dict[str, Any]] | None = None,
        rationale: str = "",
    ) -> dict[str, Any]:
        """
        Presents a dynamic dataset creation proposal to the user for interactive confirmation before materializing it in DuckDB.
        Accepts EITHER:
        - `records`: A list of dictionary rows with any dynamic schema (e.g. features + authors, issues + authors, module metrics) synthesized by the agent or extracted from the repo, OR
        - `sql_query`: A DuckDB SELECT query against existing or staged tables.
        The user will see an interactive confirmation card with 'Approve & Create' and 'Decline' buttons in the chat.
        """
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", table_name.lower().strip()).strip("_")
        if not safe_name:
            return {"error": "Invalid dataset table name."}

        preview_row_count = 0
        columns: list[str] = []
        sample_rows: list[dict[str, Any]] = []
        effective_sql = (sql_query or "").strip()

        if records and isinstance(records, list) and len(records) > 0:
            staged = duckdb_service.stage_proposed_records(safe_name, records, description)
            if staged.get("error"):
                return {"error": staged["error"]}
            preview_row_count = staged["row_count"]
            columns = staged["columns"]
            sample_rows = staged["sample_rows"]
            if not effective_sql:
                effective_sql = f"SELECT * FROM {safe_name}"
        elif effective_sql:
            try:
                v_res = duckdb_service.execute_query(effective_sql, limit=5)
                if v_res.get("error"):
                    return {"error": f"SQL query failed validation: {v_res['error']}"}
                preview_row_count = v_res.get("total_rows", 0)
                columns = v_res.get("columns", [])
                sample_rows = v_res.get("data", [])[:5]
            except Exception as e:
                return {"error": f"SQL query failed validation: {e}"}
        else:
            existing_staged = duckdb_service.get_staged_records(safe_name)
            if existing_staged:
                preview_row_count = len(existing_staged)
                columns = list(existing_staged[0].keys()) if existing_staged else []
                sample_rows = existing_staged[:5]
                effective_sql = f"SELECT * FROM {safe_name}"
            else:
                return {"error": "Provide either `records` (list of row objects) or a valid `sql_query` to propose a dataset."}

        prop_id = f"prop-{uuid.uuid4().hex[:8]}"
        proposal_payload: dict[str, Any] = {
            "id": prop_id,
            "type": "dataset",
            "table_name": safe_name,
            "sql_query": effective_sql,
            "description": description or f"Dynamic dataset {safe_name}",
            "rationale": rationale or f"Proposing custom dataset '{safe_name}' ({preview_row_count} rows) for analysis",
            "preview_row_count": preview_row_count,
            "columns": columns,
            "sample_rows": sample_rows,
            "status": "pending",
        }
        if emitted_proposals is not None:
            emitted_proposals.append({
                "type": "dataset_proposal",
                "proposal": proposal_payload,
            })

        return {
            "status": "proposal_created",
            "proposal_id": prop_id,
            "table_name": safe_name,
            "row_count": preview_row_count,
            "columns": columns,
            "message": f"Proposal for dataset '{safe_name}' ({preview_row_count} rows, columns: {columns}) displayed to user for confirmation. You can also query `{safe_name}` in `upsert_chart_widget` immediately.",
        }

    def ask_user_confirmation(
        question: str,
        options: list[str],
        context: str = "",
    ) -> dict[str, Any]:
        """
        Asks the user for confirmation, clarification, or acceptance among a list of recommendations
        before proceeding with any persistent actions.
        Presents interactive choice buttons directly in the chat UI.
        """
        inq_id = f"inq-{uuid.uuid4().hex[:8]}"
        inquiry_payload = {
            "id": inq_id,
            "question": question,
            "options": options or ["Yes, proceed", "No, decline"],
            "context": context,
            "status": "pending",
        }
        if emitted_proposals is not None:
            emitted_proposals.append({
                "type": "user_inquiry",
                "inquiry": inquiry_payload,
            })

        return {
            "status": "question_asked",
            "inquiry_id": inq_id,
            "question": question,
            "options": options,
            "message": "Question presented to user with clickable choice chips in chat.",
        }

    def materialize_duckdb_dataset(
        table_name: str,
        sql_query: str = "",
        records: list[dict[str, Any]] | None = None,
        description: str = "",
    ) -> dict[str, Any]:
        """
        Directly materializes a custom DuckDB table from `records` (list of dicts) or a `sql_query`.
        NOTE: Prefer calling `propose_duckdb_dataset` first so the user can review and approve the schema and sample rows.
        Only call `materialize_duckdb_dataset` directly if the user explicitly commanded immediate table creation.
        """
        try:
            target_records = records
            if not target_records:
                target_records = duckdb_service.get_staged_records(table_name)
            if not target_records and sql_query:
                q_res = duckdb_service.execute_query(sql_query, limit=5000)
                target_records = q_res.get("data", [])
            if not target_records:
                return {"error": "No records or SQL query results found to materialize."}
            return duckdb_service.materialize_dataset(
                table_name=table_name,
                records=target_records,
                lineage={
                    "origin_type": "agent_derived",
                    "derivation_summary": description or f"Dynamic dataset {table_name}",
                    "source_query": sql_query or f"SELECT * FROM {table_name}",
                },
            )
        except Exception as e:
            return {"error": f"Failed to materialize dataset: {e}"}

    def upsert_chart_widget(
        title: str,
        archetype: str,
        sql_query: str = "",
        data_records: list[dict[str, Any]] | None = None,
        x_field: str = "",
        y_fields: list[str] | None = None,
        subtitle: str = "",
        widget_id: str = "",
        filter_scope: str = "global",
        user_confirmed: bool = False,
    ) -> dict[str, Any]:
        """
        Creates or updates an interactive Apache ECharts or Table widget on the active dashboard canvas.
        Can be backed EITHER by a `sql_query` (against any DuckDB or staged dataset) OR directly by `data_records` (list of row objects).
        Supported archetypes: 'bar', 'horizontal_bar', 'stacked_bar', 'line', 'area', 'multi_line', 'pie', 'donut', 'scatter', 'radar', 'heatmap', 'calendar', 'calendar_heatmap', 'treemap', 'funnel', 'gauge', 'kpi', 'table'.
        NOTE: Updating an existing widget requires user permission. Only pass `user_confirmed=True` when the user has approved updating the chart.
        """
        # Guard: If targeting an existing widget on the dashboard, require user confirmation before replacing it
        existing_target = None
        if widget_id and current_dashboard_id:
            try:
                from backend.app.database import SessionLocal
                from backend.app.models import DashboardWidget
                with SessionLocal() as db:
                    w_obj = db.query(DashboardWidget).filter(
                        DashboardWidget.dashboard_id == current_dashboard_id,
                        DashboardWidget.widget_id == widget_id.strip()
                    ).first()
                    if w_obj:
                        existing_target = {
                            "id": w_obj.widget_id,
                            "title": w_obj.title,
                            "widget_type": w_obj.widget_type,
                        }
            except Exception as e:
                logger.warning(f"Error querying widget {widget_id}: {e}")

        if existing_target is not None and not user_confirmed:
            inq_id = f"chart-update-{uuid.uuid4().hex[:8]}"
            target_title = existing_target.get("title") or widget_id
            inquiry_payload = {
                "id": inq_id,
                "type": "chart_update_approval",
                "target_widget_id": widget_id,
                "target_title": target_title,
                "proposed_title": title,
                "proposed_archetype": archetype,
                "question": f"Update existing chart '{target_title}'?",
                "context": (
                    f"Target Chart: \"{target_title}\" (`{widget_id}`)\n"
                    f"Proposed New Title: \"{title}\"\n"
                    f"Proposed Archetype: {archetype}\n"
                    f"Data Source / Query: `{sql_query or 'Inline data records'}`"
                ),
                "options": [
                    f"Approve: Update '{target_title}'",
                    "Add as New Chart Instead",
                    "Decline Update",
                ],
                "status": "pending",
            }
            if emitted_proposals is not None:
                emitted_proposals.append({
                    "type": "user_inquiry",
                    "inquiry": inquiry_payload,
                })
            return {
                "status": "approval_requested",
                "inquiry_id": inq_id,
                "target_widget_id": widget_id,
                "target_title": target_title,
                "proposed_title": title,
                "proposed_archetype": archetype,
                "message": (
                    f"Existing chart '{target_title}' (`{widget_id}`) is protected from accidental replacement. "
                    f"An approval request with options ('Approve: Update', 'Add as New Chart Instead', 'Decline Update') has been displayed to the user."
                ),
            }

        if data_records and isinstance(data_records, list) and len(data_records) > 0:
            cols = list(data_records[0].keys()) if isinstance(data_records[0], dict) else []
            data_rows = data_records
            datasource_meta = {"type": "agent_records", "query": sql_query or ""}
        elif sql_query:
            q_res = duckdb_service.execute_widget_query(sql_query, filter_scope=filter_scope)
            if q_res.get("error"):
                return {"error": q_res["error"], "sql_query": sql_query}
            cols = q_res.get("columns", [])
            data_rows = q_res.get("data", [])
            datasource_meta = {"type": "duckdb", "query": sql_query}
        else:
            return {"error": "Provide either `sql_query` or `data_records` to `upsert_chart_widget`."}

        v_opts = {"x_field": x_field, "y_fields": y_fields or []}
        w_spec = compile_widget_spec(
            archetype=archetype,
            title=title,
            subtitle=subtitle,
            sql=sql_query,
            columns=cols,
            rows=data_rows,
            visual_options=v_opts,
            filter_scope=filter_scope,
        )
        w_id = widget_id.strip() if widget_id else f"agent-chart-{int(time.time() * 1000)}"
        widget_payload = {
            "id": w_id,
            "title": title,
            "widget_type": "table" if archetype.lower() in ("table", "pivot", "rowspan_table") else "echarts",
            "grid": {"x": 0, "y": 0, "w": 6, "h": 5},
            "spec": w_spec,
            "datasource": datasource_meta,
        }
        is_update = persist_widget_to_dashboard(
            current_dashboard_id, widget_payload, resolve_comments_on_update=True
        )
        action_event = {
            "type": "canvas_action",
            "action": "update_widget" if is_update else "create_widget",
            "widget": widget_payload,
        }
        emitted_canvas_actions.append(action_event)
        return {
            "status": "mounted",
            "action": action_event["action"],
            "widget_id": w_id,
            "title": title,
            "row_count": len(data_rows),
        }

    def create_markdown_report_widget(
        title: str,
        markdown_content: str,
        widget_id: str = "",
        user_confirmed: bool = False,
    ) -> dict[str, Any]:
        """Creates or updates a structured Markdown engineering report card on the active dashboard canvas."""
        existing_target = None
        if widget_id and current_dashboard_id:
            try:
                from backend.app.database import SessionLocal
                from backend.app.models import DashboardWidget
                with SessionLocal() as db:
                    w_obj = db.query(DashboardWidget).filter(
                        DashboardWidget.dashboard_id == current_dashboard_id,
                        DashboardWidget.widget_id == widget_id.strip()
                    ).first()
                    if w_obj:
                        existing_target = {
                            "id": w_obj.widget_id,
                            "title": w_obj.title,
                            "widget_type": w_obj.widget_type,
                        }
            except Exception as e:
                logger.warning(f"Error querying report widget {widget_id}: {e}")

        if existing_target is not None and not user_confirmed:
            inq_id = f"report-update-{uuid.uuid4().hex[:8]}"
            target_title = existing_target.get("title") or widget_id
            inquiry_payload = {
                "id": inq_id,
                "type": "report_update_approval",
                "target_widget_id": widget_id,
                "target_title": target_title,
                "proposed_title": title,
                "question": f"Update existing report card '{target_title}'?",
                "context": f"Target Report: \"{target_title}\" (`{widget_id}`)\nProposed Title: \"{title}\"",
                "options": [
                    f"Approve: Update '{target_title}'",
                    "Add as New Report Instead",
                    "Decline Update",
                ],
                "status": "pending",
            }
            if emitted_proposals is not None:
                emitted_proposals.append({
                    "type": "user_inquiry",
                    "inquiry": inquiry_payload,
                })
            return {
                "status": "approval_requested",
                "inquiry_id": inq_id,
                "target_widget_id": widget_id,
                "target_title": target_title,
                "proposed_title": title,
                "message": (
                    f"Existing report card '{target_title}' (`{widget_id}`) is protected from accidental replacement. "
                    f"An approval request has been displayed to the user."
                ),
            }

        w_id = widget_id.strip() if widget_id else f"agent-report-{int(time.time() * 1000)}"
        widget_payload = {
            "id": w_id,
            "title": title,
            "widget_type": "text_audit",
            "grid": {"x": 0, "y": 0, "w": 6, "h": 5},
            "datasource": {"type": "agent_report", "label": "Repository Analysis Report"},
            "spec": {
                "type": "text_audit",
                "status": "Analysis Complete",
                "markdown": markdown_content[:4500],
            },
        }
        is_update = persist_widget_to_dashboard(
            current_dashboard_id, widget_payload, resolve_comments_on_update=True
        )
        action_event = {
            "type": "canvas_action",
            "action": "update_widget" if is_update else "create_widget",
            "widget": widget_payload,
        }
        emitted_canvas_actions.append(action_event)
        return {
            "status": "mounted",
            "action": action_event["action"],
            "widget_id": w_id,
            "title": title,
        }

    def create_single_filter_widget(
        dimension: str,
        filter_type: str = "dropdown",
        target_widget_id: str = "all",
    ) -> dict[str, Any]:
        """
        Mounts an interactive single-dimension cross-filter widget (e.g., author, repo, commit_type, branch) on the canvas.
        Supported filter_types: 'dropdown', 'multi_dropdown', 'checkbox', 'radio', 'date_picker'.
        """
        try:
            safe_dim = re.sub(r"[^a-zA-Z0-9_]", "", dimension) or "author"
            if safe_dim in ("repo_name", "repository"):
                safe_dim = "repo"
            elif safe_dim in ("author_name", "committer", "committers"):
                safe_dim = "author"
            elif safe_dim in ("type", "kind"):
                safe_dim = "commit_type"

            tables_map = duckdb_service.get_table_columns_map()
            matching_table = None
            matched_col = safe_dim
            for tbl, cols in tables_map.items():
                if safe_dim in cols:
                    matching_table = tbl
                    matched_col = safe_dim
                    break
                for col_name in cols:
                    if safe_dim in col_name or col_name in safe_dim:
                        matching_table = tbl
                        matched_col = col_name
                        break
                if matching_table:
                    break

            options: list[str] = []
            if matching_table:
                try:
                    res = duckdb_service.execute_query(
                        f"SELECT DISTINCT {matched_col} AS val FROM {matching_table} WHERE {matched_col} IS NOT NULL ORDER BY 1 LIMIT 40"
                    )
                    options = [str(r.get("val")) for r in res.get("data", []) if r.get("val") is not None]
                except Exception:
                    options = []

            if not options and current_dashboard_id:
                _, active_widgets_list, _, _ = get_dashboard_context(current_dashboard_id)
                seen_opts: set[str] = set()
                for w in active_widgets_list:
                    sp = w.get("spec") or {}
                    raw_rows = (sp.get("raw_table") or {}).get("rows") or sp.get("rows") or []
                    if isinstance(raw_rows, list):
                        for r in raw_rows:
                            if isinstance(r, dict):
                                for k, v in r.items():
                                    if v is not None and (k.lower() == safe_dim or safe_dim in k.lower()):
                                        s_val = str(v).strip()
                                        if s_val and s_val not in seen_opts:
                                            seen_opts.add(s_val)
                                            options.append(s_val)
                options = options[:40]

            clean_label = safe_dim.replace("_", " ").title()
            targets = [target_widget_id] if target_widget_id and target_widget_id != "all" else ["all"]
            filter_widget = build_single_filter_widget(
                filter_type=filter_type or "dropdown",
                dimension=safe_dim,
                label=clean_label,
                options=options,
                target_widget_ids=targets,
            )

            # If targeting a specific widget, mount it above/compactly with w: 4, h: 2
            if target_widget_id and target_widget_id != "all":
                filter_widget["grid"] = {"x": 0, "y": 0, "w": 4, "h": 2}

            persist_widget_to_dashboard(current_dashboard_id, filter_widget)
            action_event = {
                "type": "canvas_action",
                "action": "create_widget",
                "widget": filter_widget,
            }
            emitted_canvas_actions.append(action_event)
            return {
                "status": "mounted",
                "widget_id": filter_widget["id"],
                "dimension": safe_dim,
                "filter_type": filter_widget.get("spec", {}).get("filter_type", filter_type),
                "options_count": len(options),
                "target_widget_id": target_widget_id,
            }
        except Exception as e:
            logger.error(f"Failed to create single filter widget: {e}", exc_info=True)
            return {"error": f"Failed to create filter widget: {str(e)}"}

    def list_repository_files(repo: str, directory: str = "", extension: str = "") -> dict[str, Any]:
        """
        Lists tracked files in the repository or a specific subfolder, optionally filtered by file extension (.py, .ts, .tsx, etc.).
        Autonomous read tool - executes immediately without user prompt.
        """
        target_path = resolve_local_repo_path(repo)
        args = ["ls-tree", "-r", "--name-only", "HEAD"]
        if directory:
            clean_dir = directory.lstrip("/\\")
            args.extend(["--", clean_dir])
        rc, stdout, _ = git_service._run_git(args, cwd=target_path)
        if rc != 0:
            files = []
            scan_dir = target_path / directory.lstrip("/\\") if directory else target_path
            if scan_dir.exists():
                for p in scan_dir.rglob("*"):
                    if p.is_file() and ".git" not in p.parts:
                        files.append(str(p.relative_to(target_path)))
        else:
            files = [line.strip() for line in stdout.split("\n") if line.strip()]

        if extension:
            ext_clean = "." + extension.lstrip(".")
            files = [f for f in files if f.endswith(ext_clean)]

        return {
            "repo": target_path.name,
            "directory": directory or "(root)",
            "extension": extension or "all",
            "total_files": len(files),
            "files": files[:200],
            "truncated": len(files) > 200,
        }

    def read_repository_file(repo: str, file_path: str, start_line: int = 1, end_line: int = 250) -> dict[str, Any]:
        """
        Safely reads the contents and line numbers of a source code or config file inside the repository.
        Supports both working-tree clones and bare git repositories (`git show HEAD:<file>`).
        Supports line pagination (start_line to end_line) to avoid overflowing context.
        Autonomous read tool - executes immediately without user prompt.
        """
        target_path = resolve_local_repo_path(repo)
        clean_rel = file_path.lstrip("/\\")
        if ".." in Path(clean_rel).parts:
            return {"error": f"Access denied: path '{file_path}' traverses outside repository root."}
        full_path = (target_path / clean_rel).resolve()
        if not str(full_path).startswith(str(target_path.resolve())):
            return {"error": f"Access denied: path '{file_path}' traverses outside repository root."}

        content: str | None = None
        if full_path.exists():
            if not full_path.is_file():
                return {"error": f"Path '{file_path}' is a directory, not a file. Use `list_repository_files` instead."}
            try:
                content = full_path.read_text(encoding="utf-8", errors="replace")
            except Exception as e:
                return {"error": f"Failed to read file '{file_path}': {str(e)}"}
        else:
            # Fallback for bare repositories (e.g. hog.git) via git show HEAD:<clean_rel>
            rc, stdout, stderr = git_service._run_git(["show", f"HEAD:{clean_rel}"], cwd=target_path)
            if rc != 0:
                return {"error": f"File '{file_path}' not found in repository '{target_path.name}' ({stderr or 'missing in HEAD'})."}
            content = stdout

        lines = content.splitlines()
        total_lines = len(lines)
        s_idx = max(1, start_line)
        e_idx = min(total_lines, max(s_idx, end_line))
        sliced = lines[s_idx - 1 : e_idx]
        numbered = [f"{i + s_idx:4d} | {line}" for i, line in enumerate(sliced)]
        return {
            "repo": target_path.name,
            "file_path": clean_rel,
            "total_lines": total_lines,
            "start_line": s_idx,
            "end_line": e_idx,
            "lines_shown": len(sliced),
            "content": "\n".join(numbered),
        }

    def search_repository_code(repo: str, query: str, path_pattern: str = "") -> dict[str, Any]:
        """
        Fast keyword or regex search across repository source code using `git grep`.
        Returns matching file paths, line numbers, and matching code lines.
        Autonomous read tool - executes immediately without user prompt.
        """
        target_path = resolve_local_repo_path(repo)
        if not query.strip():
            return {"error": "Search query cannot be empty."}
        args = ["grep", "-n", "-I", "--max-depth=10", "-e", query]
        if path_pattern:
            args.extend(["--", path_pattern])
        rc, stdout, _ = git_service._run_git(args, cwd=target_path)
        matches = []
        if rc == 0 and stdout:
            for line in stdout.splitlines()[:50]:
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    matches.append({
                        "file": parts[0],
                        "line": int(parts[1]) if parts[1].isdigit() else 0,
                        "snippet": parts[2].strip(),
                    })
        return {
            "repo": target_path.name,
            "query": query,
            "total_matches": len(matches),
            "matches": matches,
            "note": "Top 50 matches shown" if len(matches) == 50 else f"{len(matches)} matches found",
        }

    def analyze_code_complexity(repo: str, file_path: str = "") -> dict[str, Any]:
        """
        Performs static AST code analysis to compute function length, cyclomatic complexity,
        arguments, and tech debt hotspots.
        If file_path is provided, analyzes that specific file in detail.
        If file_path is empty, scans repository code files to identify the top most complex functions across the codebase.
        Autonomous read tool - executes immediately without user prompt.
        """
        target_path = resolve_local_repo_path(repo)

        def analyze_py_source(rel_path: str, src: str) -> list[dict[str, Any]]:
            try:
                tree = ast.parse(src)
            except Exception:
                return []
            res = []
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    branches = 1
                    for child in ast.walk(node):
                        if isinstance(child, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.ExceptHandler, ast.With, ast.AsyncWith)):
                            branches += 1
                        elif isinstance(child, ast.BoolOp):
                            branches += len(child.values) - 1
                    end_line = getattr(node, "end_lineno", node.lineno)
                    loc = end_line - node.lineno + 1
                    rating = "low" if branches <= 5 else ("moderate" if branches <= 10 else ("high" if branches <= 20 else "very_high"))
                    res.append({
                        "file": rel_path,
                        "function": node.name,
                        "line": node.lineno,
                        "loc": loc,
                        "args_count": len(node.args.args),
                        "cyclomatic_complexity": branches,
                        "complexity_rating": rating,
                    })
            return res

        def analyze_generic_source(rel_path: str, src: str) -> list[dict[str, Any]]:
            res = []
            lines = src.splitlines()
            for idx, line in enumerate(lines):
                m = re.search(r"\b(function\s+([a-zA-Z0-9_]+)|const\s+([a-zA-Z0-9_]+)\s*=\s*(async\s*)?\(|def\s+([a-zA-Z0-9_]+)|func\s+([a-zA-Z0-9_]+))", line)
                if m:
                    fn_name = m.group(2) or m.group(3) or m.group(5) or m.group(6) or "anonymous"
                    block = "\n".join(lines[idx : min(len(lines), idx + 50)])
                    branch_count = 1 + len(re.findall(r"\b(if|for|while|catch|case|switch)\b|&&|\|\|", block))
                    res.append({
                        "file": rel_path,
                        "function": fn_name,
                        "line": idx + 1,
                        "loc": min(50, len(lines) - idx),
                        "args_count": line.count(",") + (1 if "(" in line and ")" in line and not "()" in line else 0),
                        "cyclomatic_complexity": branch_count,
                        "complexity_rating": "low" if branch_count <= 5 else ("moderate" if branch_count <= 10 else "high"),
                    })
            return res

        if file_path:
            clean_rel = file_path.lstrip("/\\")
            if ".." in Path(clean_rel).parts:
                return {"error": "Access denied: invalid relative path."}
            full_path = (target_path / clean_rel).resolve()
            if full_path.exists() and full_path.is_file():
                src = full_path.read_text(encoding="utf-8", errors="replace")
            else:
                rc, stdout, _ = git_service._run_git(["show", f"HEAD:{clean_rel}"], cwd=target_path)
                if rc != 0:
                    return {"error": f"File '{file_path}' not found in repo."}
                src = stdout
            fn_stats = analyze_py_source(clean_rel, src) if clean_rel.endswith(".py") else analyze_generic_source(clean_rel, src)
            fn_stats.sort(key=lambda x: (x["cyclomatic_complexity"], x["loc"]), reverse=True)
            return {
                "repo": target_path.name,
                "file_path": clean_rel,
                "total_functions": len(fn_stats),
                "high_complexity_functions": [f for f in fn_stats if f["cyclomatic_complexity"] > 10],
                "functions": fn_stats[:30],
            }
        else:
            all_fns = []
            files_scanned = 0
            valid_exts = (".py", ".ts", ".tsx", ".js", ".go", ".rs", ".java")
            for ext in valid_exts:
                for p in list(target_path.rglob(f"*{ext}"))[:40]:
                    if ".git" in p.parts or "node_modules" in p.parts or "venv" in p.parts or ".venv" in p.parts:
                        continue
                    files_scanned += 1
                    rel = str(p.relative_to(target_path))
                    try:
                        src = p.read_text(encoding="utf-8", errors="replace")
                        fns = analyze_py_source(rel, src) if ext == ".py" else analyze_generic_source(rel, src)
                        all_fns.extend(fns)
                    except Exception:
                        pass

            # Fallback for bare repositories where working-tree rglob yields 0 files
            if files_scanned == 0:
                rc, stdout, _ = git_service._run_git(["ls-tree", "-r", "--name-only", "HEAD"], cwd=target_path)
                if rc == 0 and stdout:
                    candidate_files = [
                        line.strip()
                        for line in stdout.splitlines()
                        if line.strip().endswith(valid_exts)
                        and "node_modules/" not in line
                        and "vendor/" not in line
                    ][:60]
                    for rel in candidate_files:
                        rc_f, src_f, _ = git_service._run_git(["show", f"HEAD:{rel}"], cwd=target_path)
                        if rc_f == 0 and src_f:
                            files_scanned += 1
                            fns = analyze_py_source(rel, src_f) if rel.endswith(".py") else analyze_generic_source(rel, src_f)
                            all_fns.extend(fns)

            all_fns.sort(key=lambda x: (x["cyclomatic_complexity"], x["loc"]), reverse=True)
            return {
                "repo": target_path.name,
                "files_scanned": files_scanned,
                "total_functions_analyzed": len(all_fns),
                "top_complex_functions": all_fns[:20],
                "complexity_distribution": {
                    "low": len([f for f in all_fns if f["complexity_rating"] == "low"]),
                    "moderate": len([f for f in all_fns if f["complexity_rating"] == "moderate"]),
                    "high": len([f for f in all_fns if f["complexity_rating"] in ("high", "very_high")]),
                },
            }

    def propose_repository_command(
        repo: str,
        command: str,
        rationale: str = "",
    ) -> dict[str, Any]:
        """
        Presents an executable terminal or build command in the specified repository to the user
        for interactive approval before running it.
        CRITICAL GATED OPERATION: Running tests, build tools, linters, or git mutations MUST call this tool.
        """
        target_path = resolve_local_repo_path(repo)
        inq_id = f"cmd-{uuid.uuid4().hex[:8]}"
        cmd_clean = command.strip()
        approve_label = f"Approve: Run `{cmd_clean}`" if (len(cmd_clean) <= 30 and "\n" not in cmd_clean) else "Approve & Run Command"
        inquiry_payload = {
            "id": inq_id,
            "type": "command_approval",
            "repo": target_path.name,
            "command": command,
            "rationale": rationale or "Execute repository command",
            "question": f"Execute command in repository '{target_path.name}'?",
            "context": f"Rationale: {rationale or 'Execute repository command'}\n\n```bash\n{command}\n```",
            "options": [approve_label, "Decline"],
            "status": "pending",
        }
        if emitted_proposals is not None:
            emitted_proposals.append({
                "type": "user_inquiry",
                "inquiry": inquiry_payload,
            })
        return {
            "status": "approval_requested",
            "inquiry_id": inq_id,
            "repo": target_path.name,
            "command": command,
            "message": f"Command `{command}` presented to user for interactive confirmation. The user will see clickable choice buttons in chat.",
        }

    def execute_approved_repository_command(
        repo: str,
        command: str,
    ) -> dict[str, Any]:
        """
        Executes an approved read-only or authorized shell command inside the repository directory.
        Only call this tool when the user has explicitly confirmed or instructed execution.
        """
        target_path = resolve_local_repo_path(repo)
        forbidden = ["rm -rf /", "mkfs", "dd if=", ":(){ :|:& };:", "> /dev/sda"]
        for f in forbidden:
            if f in command:
                return {"error": f"Command blocked: contains dangerous pattern '{f}'."}

        try:
            import subprocess
            proc = subprocess.run(
                command,
                shell=True,
                cwd=str(target_path),
                capture_output=True,
                text=True,
                timeout=60,
            )
            return {
                "repo": target_path.name,
                "command": command,
                "exit_code": proc.returncode,
                "stdout": proc.stdout[:4000],
                "stderr": proc.stderr[:2000],
                "status": "success" if proc.returncode == 0 else "error",
            }
        except subprocess.TimeoutExpired:
            return {"error": "Command timed out after 60 seconds."}
        except Exception as e:
            return {"error": f"Failed to execute command: {str(e)}"}

    def propose_file_edit(
        repo: str,
        file_path: str,
        proposed_content: str,
        rationale: str = "",
    ) -> dict[str, Any]:
        """
        Presents a proposed file modification or creation to the user for interactive approval.
        CRITICAL GATED OPERATION: Modifying repository code MUST call this tool first so the user can review before applying.
        """
        target_path = resolve_local_repo_path(repo)
        inq_id = f"edit-{uuid.uuid4().hex[:8]}"
        snippet = proposed_content[:1000] + ("\n... [truncated]" if len(proposed_content) > 1000 else "")
        inquiry_payload = {
            "id": inq_id,
            "type": "file_edit_approval",
            "question": f"Apply proposed changes to '{file_path}' in repo '{target_path.name}'?",
            "context": f"File: `{file_path}`\nRationale: {rationale or 'Code update'}\n\n```\n{snippet}\n```",
            "options": [f"Approve: Update `{file_path}`", "Decline"],
            "status": "pending",
        }
        if emitted_proposals is not None:
            emitted_proposals.append({
                "type": "user_inquiry",
                "inquiry": inquiry_payload,
            })
        return {
            "status": "approval_requested",
            "inquiry_id": inq_id,
            "repo": target_path.name,
            "file_path": file_path,
            "message": f"Proposed edit for `{file_path}` presented to user for interactive confirmation.",
        }

    def apply_approved_file_edit(
        repo: str,
        file_path: str,
        proposed_content: str,
    ) -> dict[str, Any]:
        """
        Applies an approved file modification or creation inside a working-tree repository.
        Only call this tool after the user has explicitly confirmed `propose_file_edit` or requested the file write.
        """
        target_path = resolve_local_repo_path(repo).resolve()
        is_bare = (target_path / "HEAD").is_file() and not (target_path / ".git").exists()
        if is_bare:
            return {"error": f"Repository '{target_path.name}' is a bare clone without a working tree; file edits require a full working-tree clone."}

        clean_rel = file_path.lstrip("/\\")
        if not clean_rel or ".." in Path(clean_rel).parts:
            return {"error": f"Access denied: invalid file path '{file_path}'."}

        full_path = (target_path / clean_rel).resolve()
        if not str(full_path).startswith(str(target_path) + os.sep):
            return {"error": f"Access denied: path '{file_path}' traverses outside repository root."}

        try:
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(proposed_content, encoding="utf-8")
            return {
                "status": "success",
                "repo": target_path.name,
                "file_path": clean_rel,
                "bytes_written": len(proposed_content.encode("utf-8")),
                "message": f"Successfully updated '{clean_rel}' in repository '{target_path.name}'.",
            }
        except Exception as e:
            return {"error": f"Failed to write file '{clean_rel}': {e}"}

    return [
        list_repositories_and_datasets,
        list_git_branches,
        analyze_git_repository,
        extract_repository_dataset_records,
        list_repository_files,
        read_repository_file,
        search_repository_code,
        analyze_code_complexity,
        propose_repository_command,
        execute_approved_repository_command,
        propose_file_edit,
        apply_approved_file_edit,
        query_duckdb,
        propose_duckdb_dataset,
        ask_user_confirmation,
        materialize_duckdb_dataset,
        upsert_chart_widget,
        create_markdown_report_widget,
        create_single_filter_widget,
    ]


def extract_and_persist_canvas_actions(
    full_text: str,
    current_dashboard_id: str | None,
    active_widgets: list[dict[str, Any]],
    active_comments: list[dict[str, Any]],
    provider_label: str,
    already_emitted_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Inspects the completed assistant response for any declarative ```json ... ``` ECharts specifications
    or generated markdown report files and persists them to the active dashboard if not already emitted by a tool.
    """
    if not current_dashboard_id:
        return []

    already_emitted_ids = already_emitted_ids or set()
    actions: list[dict[str, Any]] = []

    for match in re.finditer(r"```json\s*(\{.*?\})\s*```", full_text, flags=re.DOTALL):
        try:
            spec = json.loads(match.group(1))
            if not isinstance(spec, dict):
                continue
            if not any(k in spec for k in ("series", "xAxis", "yAxis", "dataset", "title", "archetype")):
                continue

            title_str = safe_extract_title(spec, "Repository Metric Chart")
            spec_id = spec.get("id") or spec.get("widget_id")

            # CRITICAL SAFETY RULE: Never randomly overwrite existing canvas widgets via fuzzy title or comment matching.
            # Only mount as an update if spec_id explicitly matches an existing widget; otherwise create as a distinct new widget.
            existing_target = None
            if spec_id:
                existing_target = next((w for w in active_widgets if w["id"] == spec_id), None)

            is_update = existing_target is not None
            widget_id = (
                existing_target["id"]
                if is_update
                else (spec_id or f"agent-chart-{int(time.time() * 1000)}-{len(actions)}")
            )
            if widget_id in already_emitted_ids:
                continue

            grid = existing_target.get("grid") if is_update else {"x": 0, "y": 0, "w": 6, "h": 5}
            widget_payload = {
                "id": widget_id,
                "title": (
                    title_str
                    if title_str != "Repository Metric Chart" and title_str
                    else (existing_target["title"] if existing_target else title_str)
                ),
                "widget_type": "echarts",
                "grid": grid,
                "datasource": {"type": "agent_sdk", "label": provider_label},
                "spec": spec,
            }
            was_updated = persist_widget_to_dashboard(
                current_dashboard_id, widget_payload, resolve_comments_on_update=True
            )
            already_emitted_ids.add(widget_id)
            actions.append({
                "type": "canvas_action",
                "action": "update_widget" if (is_update or was_updated) else "create_widget",
                "widget": widget_payload,
            })
        except Exception as e:
            logger.debug(f"Skipping non-ECharts JSON block: {e}")

    return actions
