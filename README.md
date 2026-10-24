# Antigravity Cockpit: Chat & Dynamic Canvas Studio

A full-stack AI development cockpit combining the **Google Antigravity SDK**, **Model Context Protocol (MCP)** dynamic tool wiring, and an interactive **Hybrid Dashboard Canvas** built with **Google Material Expressive (M3)** design principles.

---

## Highlights & Features

- **Chat + Dynamic Canvas Studio:**
  - Conversations don't just dump text into chat bubbles; the Antigravity agent emits declarative chart specifications (`Apache ECharts`) that render directly onto an interactive dashboard canvas in real-time.
- **GitHub Developer Productivity Module:**
  - PR Turnaround velocity & SLA monitoring.
  - Temporal commit churn heatmaps (day-of-week by hour-of-day).
  - Code review sentiment and diff size bottleneck analysis.
- **Superset 7.0 & Data Catalog Module (Headless BI):**
  - Connects to Superset 7.0 MCP servers over HTTP/SSE.
  - Queries semantic catalogs, runs slice queries, and renders time-series metrics dynamically.
- **Global & User-Scoped MCP Hub:**
  - **Global Scope (Admins):** Enterprise Superset, company data catalog, shared DBs.
  - **User Scope (Developers):** Personal GitHub PATs, individual DB credentials, personal SSE tool endpoints.
  - Live connection tester with payload preview and tool discovery.
- **Dual Storage Pattern:**
  - **PostgreSQL Database:** Users, auth tokens, chat histories, thinking traces, dashboard grid layouts, and JSON widget specifications. *(Uses local SQLite `cockpit.db` by default with zero configuration; point `DATABASE_URL` to PostgreSQL anytime).*
  - **Local Storage (`local_data/storage/`):** Safely caches bulk datasets (CSV, Parquet, diff files, export snapshots) with strict path traversal isolation.
- **Single-Service Architecture:**
  - **FastAPI** serves both the REST/SSE endpoints and the compiled **React 18 / Vite** frontend. No separate frontend dev server required in production.

---

## Quickstart

### 1. Launch the Server

Run the preconfigured startup script:
```bash
./start.sh
```

Or manually:
```bash
./.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open your browser to:
[http://127.0.0.1:8000](http://127.0.0.1:8000)

### 2. Default Seed Credentials

- **Email:** `admin@antigravity.io`
- **Password:** `antigravity123`

*(These are pre-filled in the login sheet for immediate testing).*

---

## Architectural Breakdown

Detailed architectural blueprints, MCP sequence flows, and canvas data schemas are documented in:
- [ARCHITECTURE.md](file:///home/kohul/ai/ARCHITECTURE.md)

### Verification & Testing
To run the automated end-to-end integration test (verifies static serving, JWT auth, MCP registry, dashboard widget loading, and SSE token/thought streaming):
```bash
./.venv/bin/python3 test_e2e.py
```
