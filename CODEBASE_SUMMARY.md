# Antigravity Cockpit - Codebase Summary

**AI-native engineering cockpit** that combines the Google Antigravity SDK, Model Context Protocol (MCP) tooling, and a live dashboard canvas for code review intelligence and headless BI.

## What It Is

A single-service full-stack application. FastAPI serves both the REST/SSE API and the compiled React 18 / Vite frontend. Conversations stream agent tokens, thoughts, and tool calls, then materialize the results as interactive dashboard widgets.

## Core Features

### 1. Agentic Chat + Dynamic Canvas
- Server-Sent Events stream tokens, reasoning traces, tool calls, and canvas actions.
- Agents create or update widgets directly on the active dashboard.
- Widget types: Apache ECharts charts, markdown audit cards, data tables, and sandboxed React apps.
- Canvas supports grid/showcase modes, lock/edit layout, drag-resize, widget-level chat, comments, sharing, and full-screen chart inspection.

### 2. GitHub Engineering Intelligence
- PR velocity, review turnaround, and configurable SLA monitoring.
- Commit churn heatmaps by day and hour.
- Diff-size bottleneck analysis and code review audits.
- On-demand shallow clones stored under `local_data/repos/` for fast git log, AST, and security inspection without GitHub API rate limits.
- Optional Jira MCP integration for filing defects strictly on request.

### 3. Superset Headless BI
- Queries Superset directly through `/api/v1/chart/data` and `/api/v1/sqllab/execute/` via MCP, bypassing the Superset UI.
- Data Catalog MCP supplies semantic schemas, metrics, and table lineage before query generation.
- Embedded DuckDB console with read-only SQL validation, pagination, and in-memory datasets.

### 4. MCP Hub and Agent Memory
- Global-scope connections for admins and user-scope credentials for individual developers.
- SSE and HTTP transports, connection testing, payload preview, and tool discovery.
- Two seeded personas: `github-agent` and `superset-agent`, with editable system instructions.
- Persistent context through `AGENT_CONTEXT.md`, native conversation forking, and user-scoped memory.

### 5. Security and Storage
- JWT authentication with admin/member roles.
- SQLite by default (`local_data/cockpit.db`), PostgreSQL-ready through `DATABASE_URL`.
- Sandboxed file storage with filename sanitization and path-traversal protection.
- Read-only DuckDB guard blocks DDL/DML, multi-statement queries, and filesystem access.

### 6. Material 3 Expressive UI
- React 18 + TypeScript + Vite + Tailwind.
- Light/dark themes persisted in local storage.
- Dashboard homescreen gallery, public workspace sharing, user management, repository manager, and agent instruction editor.

## Architecture at a Glance

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind, ECharts | Chat, canvas, widgets, settings |
| Backend | FastAPI, SQLAlchemy, JWT, SSE | REST API, auth, streaming, orchestration |
| Agents | Google Antigravity SDK, MCP clients | Tool routing, memory, widget emission |
| Data | SQLite/PostgreSQL, DuckDB, local disk | Persistence, analytics, clones, uploads |
| Ops | Docker, Uvicorn, Alembic | Packaging, runtime, migrations |

## Footprint

- **69 first-party source and config files**, approximately **15,300 lines**.
- Frontend: 27 files, 9,642 lines.
- Backend: 25 files, 4,553 lines.
- Docs and configuration: 16 files, 887 lines.
- Tests: `test_e2e.py`, 214 lines covering auth, agents, repositories, DuckDB safety, dashboards, widgets, and SSE streaming.
- 38 API endpoints across 7 routers and 10 SQLAlchemy models.

## Verification

```bash
./start.sh
./.venv/bin/python3 test_e2e.py
```

Default local login: `admin@antigravity.io` / `antigravity123`.
