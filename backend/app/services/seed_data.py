import datetime
import json
import logging
import uuid
import os
import subprocess
from sqlalchemy.orm import Session
from sqlalchemy import or_
from backend.app.auth import hash_password
from backend.app.config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, SEED_MOCK_DATA, REPOS_DIR
from backend.app.models import User, MCPConfig, Dashboard, DashboardWidget, AgentPersona, LocalRepository, ChatSession, ChatMessage
from backend.app.services.git_service import git_service
from backend.app.services.port_service import port_manager

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

        mock_dash_ids = ["default-cockpit", "pr-velocity-audit", "public-repo-worktree-infrastructure"]
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


def get_structured_repository_inventory(db: Session) -> list[dict]:
    """
    Discovers all local repositories, their worktrees, dev preview ports,
    and associated chat sessions across the platform.
    """
    repos = db.query(LocalRepository).all()
    structured_repos = []
    for r in repos:
        is_cloned = git_service.is_repo_cloned(r.local_path)
        if not is_cloned:
            continue
        try:
            wts = git_service.list_worktrees(r.local_path)
        except Exception:
            wts = []
        if not wts:
            wts = [{"path": r.local_path, "branch": r.default_branch or "main", "head": ""}]

        wt_list = []
        for wt in wts:
            branch = wt.get("branch", r.default_branch or "main")
            wt_path = wt.get("path", r.local_path)
            is_main = os.path.abspath(wt_path) == os.path.abspath(r.local_path)
            role = "Primary Clone" if is_main else "Linked Worktree"

            assigned_port = port_manager.get_or_allocate_port(
                db=db,
                repo_id=r.id,
                worktree_path=wt_path,
                repo_name=r.name,
                branch=branch,
            )
            preview_url = port_manager.get_preview_url(assigned_port)

            # Discover associated chat sessions for this worktree
            associated_chats = []
            if is_main:
                chat_query = db.query(ChatSession).filter(
                    ChatSession.repo_id == r.id,
                    or_(
                        ChatSession.worktree_branch == branch,
                        ChatSession.worktree_branch == None,
                        ChatSession.worktree_path == wt_path
                    )
                )
            else:
                chat_query = db.query(ChatSession).filter(
                    ChatSession.repo_id == r.id,
                    or_(
                        ChatSession.worktree_branch == branch,
                        ChatSession.worktree_path == wt_path
                    )
                )

            for s in chat_query.all():
                msg_count = db.query(ChatMessage).filter(ChatMessage.session_id == s.id).count()
                associated_chats.append({
                    "id": s.id,
                    "title": s.title or "Untitled Chat",
                    "session_type": s.session_type,
                    "agent_id": s.agent_id or "general",
                    "message_count": msg_count,
                    "updated_at": s.updated_at.strftime("%Y-%m-%d %H:%M") if s.updated_at else ""
                })

            short_sha = wt.get("head", "")[:9]
            last_commit = ""
            if os.path.exists(wt_path):
                try:
                    res = subprocess.run(
                        ["git", "-C", wt_path, "log", "-1", "--format=%h\x1f%s"],
                        capture_output=True, text=True, timeout=5
                    )
                    if res.returncode == 0 and res.stdout.strip():
                        parts = res.stdout.strip().split("\x1f")
                        short_sha = parts[0]
                        last_commit = parts[1] if len(parts) > 1 else ""
                except Exception:
                    pass

            wt_list.append({
                "branch": branch,
                "role": role,
                "is_main": is_main,
                "port": assigned_port,
                "preview_url": preview_url,
                "path": wt_path,
                "head_sha": short_sha,
                "last_commit": last_commit,
                "chats": associated_chats
            })

        structured_repos.append({
            "id": r.id,
            "name": r.name,
            "remote_url": r.remote_url,
            "default_branch": r.default_branch,
            "clone_type": r.clone_type,
            "local_path": r.local_path,
            "worktrees": wt_list
        })
    return structured_repos


def refresh_public_repository_dashboard(db: Session) -> bool:
    """
    Dynamically refreshes the repository & worktree inventory widget in the Public Workspace dashboard.
    Updates the spec with the freshest list of repositories, worktrees, dev ports, and associated chats.
    """
    dash_id = "public-repo-worktree-infrastructure"
    widget_id = "public-widget-repo-worktree-cards"

    widget = db.query(DashboardWidget).filter(
        DashboardWidget.dashboard_id == dash_id,
        DashboardWidget.widget_id == widget_id
    ).first()

    if not widget:
        return False

    try:
        spec = json.loads(widget.spec_json) if widget.spec_json else {}
        structured_repos = get_structured_repository_inventory(db)
        spec["repositories"] = structured_repos
        widget.spec_json = json.dumps(spec)
        widget.updated_at = datetime.datetime.utcnow()
        db.commit()
        return True
    except Exception as e:
        logger.warning(f"Failed to refresh public repository dashboard widget: {e}")
        return False


def ensure_public_repository_dashboard(db: Session, admin_user_id: int):
    """
    Ensures a public repository & worktree inventory dashboard exists in the Public Workspace (is_public=True).
    Explicitly catalogs:
    1. List of repositories we have
    2. What worktrees they have (branches, disk paths, dev server preview ports)
    3. What charts and visual widgets are associated with those worktrees
    """
    dash_id = "public-repo-worktree-infrastructure"
    dash = db.query(Dashboard).filter(Dashboard.id == dash_id).first()
    if not dash:
        dash = Dashboard(
            id=dash_id,
            user_id=admin_user_id,
            title="Repository & Worktree Inventory",
            description="Public directory of repositories, active Git worktrees, dev preview ports, and associated canvas charts.",
            is_default=False,
            is_public=True,
            datasources_json=json.dumps([
                {"type": "git", "name": "agor"},
                {"type": "duckdb", "name": "agor_contribution_timeline"},
                {"type": "duckdb", "name": "agor_git_blame_file_ownership"},
                {"type": "duckdb", "name": "agor_module_ownership_churn"}
            ])
        )
        db.add(dash)
        db.commit()
    else:
        dash.is_public = True
        dash.title = "Repository & Worktree Inventory"
        dash.description = "Public directory of repositories, active Git worktrees, dev preview ports, and associated canvas charts."
        db.commit()

    # Structure repositories for Cards & Table component
    structured_repos = get_structured_repository_inventory(db)

    component_code = """import React, { useState, useMemo } from 'react';
import {
  FolderGit2,
  GitBranch,
  ExternalLink,
  Search,
  LayoutGrid,
  Table as TableIcon,
  CheckCircle2,
  MessageSquare,
  Terminal,
  Activity,
  Layers,
  Sparkles
} from 'lucide-react';

export default function RepoWorktreeManager({ spec }) {
  const [viewMode, setViewMode] = useState('cards');
  const [search, setSearch] = useState('');

  const repositories = (spec && spec.repositories) || [];

  const filteredRepos = useMemo(() => {
    if (!search.trim()) return repositories;
    const q = search.toLowerCase();
    return repositories.map(repo => {
      const matchRepo = repo.name.toLowerCase().includes(q) || repo.remote_url.toLowerCase().includes(q);
      const matchingWorktrees = (repo.worktrees || []).filter(wt => {
        const matchBranch = wt.branch.toLowerCase().includes(q);
        const matchChat = (wt.chats || []).some(c => (c.title || '').toLowerCase().includes(q) || (c.agent_id || '').toLowerCase().includes(q));
        return matchBranch || matchChat;
      });
      if (matchRepo) return repo;
      if (matchingWorktrees.length > 0) return { ...repo, worktrees: matchingWorktrees };
      return null;
    }).filter(Boolean);
  }, [repositories, search]);

  const totalWorktrees = useMemo(() => {
    return repositories.reduce((acc, r) => acc + (r.worktrees ? r.worktrees.length : 0), 0);
  }, [repositories]);

  const totalChats = useMemo(() => {
    return repositories.reduce((acc, r) => {
      return acc + (r.worktrees ? r.worktrees.reduce((sum, wt) => sum + (wt.chats ? wt.chats.length : 0), 0) : 0);
    }, 0);
  }, [repositories]);

  return (
    <div className='flex flex-col gap-4 w-full h-full p-4 overflow-y-auto font-sans bg-transparent'>
      {/* Top Header & Stats */}
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-m3-outline-variant/20 shrink-0'>
        <div className='flex items-center gap-2.5'>
          <div className='w-9 h-9 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center shrink-0'>
            <FolderGit2 className='w-5 h-5 text-m3-primary' />
          </div>
          <div>
            <h2 className='text-sm font-bold text-m3-on-surface'>Repository & Worktree Catalog</h2>
            <p className='text-xs text-m3-on-surface-variant'>
              {repositories.length} repository · {totalWorktrees} active worktrees · {totalChats} associated chat sessions
            </p>
          </div>
        </div>

        {/* View Switcher & Search */}
        <div className='flex items-center gap-2'>
          <div className='relative'>
            <Search className='w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-m3-on-surface-variant' />
            <input
              type='text'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search repo, worktree, chat...'
              className='pl-8 pr-3 py-1.5 rounded-full text-xs bg-m3-surface-container-low border border-m3-outline-variant/30 text-m3-on-surface outline-none focus:border-m3-primary w-48 sm:w-56'
            />
          </div>

          <div className='flex items-center p-0.5 rounded-full bg-m3-surface-container border border-m3-outline-variant/30'>
            <button
              onClick={() => setViewMode('cards')}
              className={'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ' + (viewMode === 'cards' ? 'bg-m3-primary text-m3-on-primary' : 'text-m3-on-surface-variant hover:text-m3-on-surface')}
            >
              <LayoutGrid className='w-3 h-3' />
              <span>Cards</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ' + (viewMode === 'table' ? 'bg-m3-primary text-m3-on-primary' : 'text-m3-on-surface-variant hover:text-m3-on-surface')}
            >
              <TableIcon className='w-3 h-3' />
              <span>Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'cards' ? (
        <div className='flex flex-col gap-4'>
          {filteredRepos.map(repo => (
            <div key={repo.id} className='p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex flex-col gap-3'>
              {/* Repo Header */}
              <div className='flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-m3-outline-variant/20 gap-2'>
                <div className='flex items-center gap-2'>
                  <FolderGit2 className='w-4 h-4 text-m3-primary' />
                  <span className='font-bold text-sm text-m3-on-surface'>{repo.name}</span>
                  <span className='text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400'>
                    Default: {repo.default_branch}
                  </span>
                  <span className='text-[10px] font-mono px-2 py-0.5 rounded-full bg-m3-surface-container text-m3-on-surface-variant border border-m3-outline-variant/30'>
                    {repo.clone_type}
                  </span>
                </div>
                <div className='text-[11px] font-mono text-m3-on-surface-variant truncate max-w-sm'>
                  {repo.remote_url}
                </div>
              </div>

              {/* Worktree Cards */}
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
                {(repo.worktrees || []).map(wt => (
                  <div key={wt.branch} className='p-3.5 rounded-2xl bg-m3-surface-container/40 border border-m3-outline-variant/20 flex flex-col justify-between gap-2.5'>
                    <div className='flex flex-col gap-1.5'>
                      <div className='flex items-center justify-between gap-1'>
                        <div className='flex items-center gap-1.5'>
                          <GitBranch className='w-3.5 h-3.5 text-m3-primary shrink-0' />
                          <span className='font-mono font-bold text-xs text-m3-on-surface'>{wt.branch}</span>
                          <span className={'text-[9px] px-1.5 py-0.2 rounded-full uppercase tracking-wider font-semibold ' + (wt.is_main ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400')}>
                            {wt.is_main ? 'Primary' : 'Worktree'}
                          </span>
                        </div>
                        <a
                          href={wt.preview_url}
                          target='_blank'
                          rel='noreferrer'
                          className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-m3-surface-container text-m3-primary hover:bg-m3-surface-container-high text-[11px] font-mono font-semibold transition-colors'
                        >
                          <span>Port {wt.port}</span>
                          <ExternalLink className='w-2.5 h-2.5' />
                        </a>
                      </div>

                      <p className='text-[10px] font-mono text-m3-on-surface-variant truncate' title={wt.path}>
                        {wt.path}
                      </p>
                      {wt.last_commit && (
                        <p className='text-[11px] text-m3-on-surface truncate' title={wt.last_commit}>
                          {wt.last_commit}
                        </p>
                      )}
                    </div>

                    {/* Associated Chats */}
                    <div className='pt-2 border-t border-m3-outline-variant/15 flex flex-col gap-1.5'>
                      <span className='text-[10px] font-semibold text-m3-on-surface-variant uppercase tracking-wider'>
                        Associated Chats ({wt.chats ? wt.chats.length : 0}):
                      </span>
                      {wt.chats && wt.chats.length > 0 ? (
                        <div className='flex flex-col gap-1'>
                          {wt.chats.map((c, i) => (
                            <div
                              key={i}
                              className='flex items-center justify-between p-1.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs text-m3-on-surface'
                            >
                              <div className='flex items-center gap-1.5 truncate'>
                                <MessageSquare className='w-3 h-3 text-m3-primary shrink-0' />
                                <span className='font-medium text-xs truncate'>{c.title}</span>
                              </div>
                              <div className='flex items-center gap-1 shrink-0'>
                                <span className='text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-m3-surface-container-high text-m3-on-surface-variant'>
                                  {c.message_count} msgs
                                </span>
                                <span className='text-[9px] px-1.5 py-0.2 rounded-md bg-indigo-500/15 text-indigo-400 font-semibold'>
                                  {c.agent_id}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className='text-[10px] text-m3-on-surface-variant italic'>
                          No active chat sessions connected
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className='overflow-x-auto rounded-2xl border border-m3-outline-variant/30 bg-m3-surface-container-low'>
          <table className='w-full text-left text-xs'>
            <thead>
              <tr className='border-b border-m3-outline-variant/20 text-m3-on-surface-variant text-[11px]'>
                <th className='p-3 font-semibold'>Repository</th>
                <th className='p-3 font-semibold'>Worktree Branch</th>
                <th className='p-3 font-semibold'>Role</th>
                <th className='p-3 font-semibold'>Dev Port</th>
                <th className='p-3 font-semibold'>Associated Chats</th>
                <th className='p-3 font-semibold'>Path</th>
                <th className='p-3 font-semibold'>Status</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-m3-outline-variant/10 font-mono'>
              {filteredRepos.flatMap(r => (r.worktrees || []).map(wt => (
                <tr key={wt.path} className='hover:bg-m3-surface-container/30 transition-colors'>
                  <td className='p-3 font-semibold text-m3-on-surface font-sans'>{r.name}</td>
                  <td className='p-3 font-bold text-m3-primary'>{wt.branch}</td>
                  <td className='p-3 font-sans'>
                    <span className={'text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ' + (wt.is_main ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400')}>
                      {wt.is_main ? 'Primary Clone' : 'Linked Worktree'}
                    </span>
                  </td>
                  <td className='p-3'>
                    <a
                      href={wt.preview_url}
                      target='_blank'
                      rel='noreferrer'
                      className='inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-m3-surface-container text-m3-primary hover:bg-m3-surface-container-high font-semibold text-[11px]'
                    >
                      <span>Port {wt.port}</span>
                      <ExternalLink className='w-2.5 h-2.5' />
                    </a>
                  </td>
                  <td className='p-3 font-sans'>
                    {wt.chats && wt.chats.length > 0 ? (
                      <div className='flex flex-wrap gap-1 max-w-sm'>
                        {wt.chats.map((c, i) => (
                          <span key={i} className='inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-m3-surface-container text-m3-on-surface border border-m3-outline-variant/20'>
                            <MessageSquare className='w-2.5 h-2.5 text-m3-primary' />
                            <span className='font-medium truncate max-w-[120px]'>{c.title}</span>
                            <span className='text-[9px] text-m3-on-surface-variant font-mono'>({c.message_count}m)</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className='text-[10px] text-m3-on-surface-variant italic'>None</span>
                    )}
                  </td>
                  <td className='p-3 text-[11px] text-m3-on-surface-variant truncate max-w-xs' title={wt.path}>
                    {wt.path}
                  </td>
                  <td className='p-3 font-sans'>
                    <span className='inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400'>
                      <CheckCircle2 className='w-3 h-3' />
                      Active
                    </span>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}"""

    react_spec = {
        "type": "custom_react",
        "app_name": "Repository & Worktree Manager",
        "description": "Interactive Cards & Table manager for repositories, active worktrees, and associated canvas charts.",
        "component_code": component_code,
        "repositories": structured_repos,
        "sql": ""
    }

    widget_definitions = [
        {
            "widget_id": "public-widget-repo-worktree-cards",
            "title": "Repositories, Worktrees & Associated Charts",
            "widget_type": "react_app",
            "grid": {"x": 0, "y": 0, "w": 12, "h": 10},
            "spec": react_spec,
            "datasource": {"type": "custom_react", "label": "Repository Worktree Cards & Table Manager"}
        }
    ]

    target_widget_ids = {wdef["widget_id"] for wdef in widget_definitions}

    # Delete all previous / obsolete widgets from this dashboard
    db.query(DashboardWidget).filter(
        DashboardWidget.dashboard_id == dash_id,
        DashboardWidget.widget_id.notin_(target_widget_ids)
    ).delete(synchronize_session=False)

    for wdef in widget_definitions:
        w = db.query(DashboardWidget).filter(
            DashboardWidget.dashboard_id == dash_id,
            DashboardWidget.widget_id == wdef["widget_id"]
        ).first()
        if not w:
            w = DashboardWidget(
                dashboard_id=dash_id,
                widget_id=wdef["widget_id"],
                title=wdef["title"],
                widget_type=wdef["widget_type"],
                grid_json=json.dumps(wdef["grid"]),
                spec_json=json.dumps(wdef["spec"]),
                datasource_json=json.dumps(wdef["datasource"])
            )
            db.add(w)
        else:
            w.title = wdef["title"]
            w.widget_type = wdef["widget_type"]
            w.grid_json = json.dumps(wdef["grid"])
            w.spec_json = json.dumps(wdef["spec"])
            w.datasource_json = json.dumps(wdef["datasource"])

    db.commit()
    logger.info("Public Workspace dashboard 'Repository & Worktree Inventory' successfully ensured with clean Cards & Table UI.")
