# AI Studio

AI Studio is an AI-native development workspace combining chat, an interactive canvas dashboard, embedded DuckDB analytics, and an integrated Monaco code editor with isolated Git worktrees.

## Features

- **Agentic Chat & Canvas:** Interact with AI specialist personas and project interactive charts (Apache ECharts), reports, and widgets directly onto a dashboard canvas.
- **Embedded DuckDB Engine:** In-process SQL queries, data transformations, and columnar dataset materialization.
- **Code Studio:** Monaco editor with Git worktree isolation, file explorer, diff reviewer, and terminal command runner.
- **MCP Integration:** Connect external tools and semantic data catalogs using the Model Context Protocol.

## Quickstart

### 1. Start the Server

```bash
./start.sh
```

Or manually:
```bash
./.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

### 2. Default Login

- **Email:** `admin@antigravity.io`
- **Password:** `antigravity123`

### 3. Tests

Run the test suite:
```bash
./.venv/bin/python test_e2e.py
```
