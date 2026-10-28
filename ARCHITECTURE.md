# AI Studio: Antigravity-Powered Chat & Dynamic Canvas Studio

## 1. Executive Summary

This project is an AI-first workspace that pairs the **Google Antigravity SDK** with an interactive **Dashboard Canvas** styled with **Google Material Expressive (M3)** principles.

The platform is laser-focused on **two core verticals**:
1. **GitHub Engineering Intelligence & Code Review Studio**:
   - High-level review queues, comments, and approvals via **GitHub MCP**.
   - Deep code quality audits, AST analysis, and temporal churn dashboards via **On-Demand Local Shallow Clones**.
   - Optional context enhancement via **Jira MCP** to file tickets directly on review findings.
2. **Superset Headless BI & Data Visualization Studio**:
   - Queries Superset's backend directly via **Superset 7.0 MCP** (`/api/v1/chart/data`), bypassing the heavy Superset frontend entirely.
   - The **Antigravity Canvas serves as the custom, real-time dashboard**.
   - Optional context enhancement via **Data Catalog MCP** for semantic table/column schema discovery so the agent writes precise SQL queries.

---

## 2. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                      React 18 Frontend (M3 Expressive)                 │
│                                                                        │
│   ┌───────────────────────────┬────────────────────────────────────┐   │
│   │        Chat Panel         │          Dashboard Canvas          │   │
│   │  - Antigravity Streaming  │  - PR Velocity & SLA Tracker       │   │
│   │  - Thought & Tool traces  │  - Commit Churn Heatmaps           │   │
│   │  - Memory & Context aware │  - Superset Headless BI Charts     │   │
│   │  - Canvas command emitter │  - Mode: Grid vs. Showcase         │   │
│   │                           │  - Individual Chart Expansion      │   │
│   └─────────────┬─────────────┴─────────────────▲──────────────────┘   │
└─────────────────┼───────────────────────────────┼──────────────────────┘
                  │ Server-Sent Events (SSE)      │ REST (Canvas CRUD)
┌─────────────────▼───────────────────────────────┴──────────────────────┐
│                        FastAPI Async Backend                           │
│  - Serves static compiled React bundle (`/` & `/assets`)               │
│  - Auth & Session Manager (JWT -> OIDC ready)                          │
│  - Persistent Agent Context Loader (`AGENT_CONTEXT.md`)                │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              Antigravity SDK Agent Orchestrator                  │  │
│  │  - Injects persistent domain memory & conversation forks         │  │
│  │  - Streams thoughts, tokens, and tool calls                      │  │
│  │  - Emits declarative widget specs (`create_widget`, etc.)        │  │
│  └──────────────────┬─────────────────────────────┬─────────────────┘  │
└─────────────────────┼─────────────────────────────┼────────────────────┘
                      ▼                             ▼
       ┌──────────────────────────────┐  ┌──────────────────────────────┐
       │     PostgreSQL Database      │  │     Local Storage on Disk    │
       │                              │  │                              │
       │ - Users & Auth credentials   │  │ /local_data/repos/{repo}/    │
       │ - MCP Configs & Credentials  │  │  - Shallow clone for AST     │
       │ - Chat Sessions & Traces     │  │  - Fast git log churn        │
       │ - Dashboard & Widget Specs   │  │                              │
       └──────────────────────────────┘  └──────────────────────────────┘
```

---

## 3. The Two Core Verticals

### Vertical 1: GitHub Intelligence & Code Reviews

```
                     ┌───────────────────────┐
                     │   User Review Prompt  │
                     └──────────┬────────────┘
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
   [ Fast PR Metadata & Queue ]      [ Deep Review & High-Churn ]
   - Source: GitHub MCP              - Source: Local Shallow Clone
   - Open PR turnaround times        - `git clone --filter=blob:none`
   - Reviewer threads & sentiment    - `git log --numstat` churn analysis
   - Post approvals/comments         - AST inspection & security audit
               │                                 │
               └────────────────┬────────────────┘
                                ▼
   [ Optional Context MCP: Jira ]
   - Automatically file bug/defect tickets from review findings
```

1. **Lightweight Mode (GitHub MCP)**:
   - Fetches PR lists, diff summaries, review comments, and branch statuses.
   - Posts inline comments and approvals without touching the local disk.
2. **Deep Mode (Local Shallow Clone)**:
   - Clones into `/local_data/repos/{repo_name}` on demand with `--filter=blob:none --depth=500`.
   - Enables native sub-second execution of `git log` and language AST parsers across thousands of files without hitting GitHub API rate limits.
3. **Context Enhancer (Jira MCP)**:
   - When the agent detects a severe vulnerability, architectural violation, or unaddressed technical debt, it can invoke `jira_create_issue` to open a ticket linked to the PR.

---

### Vertical 2: Superset Headless BI Studio

```
 [ User Prompt: "Analyze Revenue Trends" ]
                   │
                   ▼
   [ Context MCP: Data Catalog ]
   - Discovers table: analytics.customer_transactions_daily
   - Validates metrics: revenue_usd, deal_count
                   │
                   ▼
   [ Direct Superset Backend (MCP) ]
   - Executes /api/v1/chart/data or /api/v1/sqllab/execute/
   - Bypasses Superset frontend entirely
                   │
                   ▼
   [ Dynamic Canvas Rendering ]
   - Renders interactive Apache ECharts widget
   - Canvas acts as the unified custom dashboard
```

1. **Direct Backend Integration**:
   - The Antigravity agent talks directly to Superset's REST/MCP endpoints (`/api/v1/chart/data` and `/api/v1/sqllab/execute/`).
   - The user never leaves AI Studio; no need to navigate Superset's complex dashboard or slice UI.
2. **Context Enhancer (Data Catalog MCP)**:
   - Supplies the semantic schema, column definitions, table lineage, and business glossary before query execution.
   - Prevents SQL syntax errors and hallucinated column names.

---

## 4. Agent Context & Memory Persistence (Why and How)

### Why Memory Matters
Without memory, the agent starts every conversation as a blank slate, asking the same clarifying questions (*"Which repo?"*, *"What are the key table names?"*, *"What is your PR SLA target?"*).

### The Three-Tier Memory Architecture

| Memory Tier | Mechanism | Best Used For |
| :--- | :--- | :--- |
| **Tier 1: Declarative Knowledge (`AGENT_CONTEXT.md`)** | Markdown file committed in workspace; injected into system prompt on agent init. | Organization conventions, coding standards, repo lists, data catalog mappings, and SLA targets. |
| **Tier 2: Conversation Forking (Antigravity Native)** | Antigravity session branching API (`fork_session`). | Preserving a "warm" session where the agent has already indexed a repo or catalog schema, allowing multiple exploration branches without re-indexing. |
| **Tier 3: Dynamic Memory Profile (`agent_memories` Table)** | PostgreSQL key-value memory store per user. | User-specific preferences learned across turns (e.g. *"preferred repo: main-service"*, *"preferred chart color theme: dark/light"*). |

---

## 5. UI/UX: Material 3 Expressive Workspace

- **Circular User Avatar Dropdown**:
  - Displays user identity, role badge, session status.
  - Quick access to **MCP Tools Hub** (Global & User-level credentials), **User Management**, and **Sign Out**.
- **Canvas View Modes**:
  - **Grid Mode**: 2-column compact dashboard.
  - **Showcase Mode**: Full-width expansive presentation canvas.
- **Individual Chart Expansion**:
  - Each chart card features a `Maximize2` button opening a dedicated high-resolution inspection modal with interactive tooltips, data point zoom, print/export, and raw ECharts option JSON inspector.

---

## 7. Context-Isolated Chat & Full-Width Canvas Architecture

### A. Free-Flow Canvas with Edit & Lock Mode (Superset Pattern)
- **Locked / View Mode (Default)**: Prevents accidental dragging, moving, or resizing while interacting with charts, zooming time series, or clicking micro-chat triggers.
- **Edit Mode ("Edit Canvas" Button)**:
  - Turns on width and height controls across all cards.
  - Allows adjusting columns (4 to 12 cols) and height cards (3 to 8 rows).
  - Clicking **"Save Layout"** locks the canvas and immediately persists coordinates to PostgreSQL.

### B. Rebranded "Assistant" with In-Place Agent Selection
- Name simplified to **"Assistant"** across all action buttons and drawer headers.
- Top bar agent selector removed in favor of choosing the agent inside the chat drawers:
  - In **Dashboard Assistant Drawer**: Select which agent to orchestrate the canvas.
  - In **Widget Micro-Chat Drawer**: Select which agent to refine the specific chart.

### C. Enhanced High-Contrast Material 3 Expressive Dark Palette
- Ultra-crisp surface elevations (`#121016`, `#19161F`, `#201D27`, `#26232D`, `#312E38`).
- High legibility typography tokens (`#F5EFF7` text, `#D0C8D6` secondary).
- Radiant Electric Violet primary (`#D0BCFF`) and clear status accents (`#49E8A2` emerald, `#FF897D` error).

### D. Token Optimization in Headless Superset Queries
- The LLM acts strictly as a **Query Planner & Spec Generator**.
- The LLM **never** reads thousands of raw database rows. It inspects table metadata via Data Catalog MCP (~200 tokens), formulates an aggregate SQL slice, and delegates execution to Superset.
- Superset returns compact tabular JSON aggregates (~10-20 rows) passed directly into ECharts on the canvas (~500-1500 tokens total).

### A. Dual Specialized Agent Personas
1. **GitHub Engineering Agent (`github-agent`)**:
   - Focuses on PR review queues, SLA bottlenecks, AST inspection, commit churn heatmaps.
   - Interacts with local repository storage (`/local_data/repos/{name}`) and GitHub MCP.
   - Raises Jira defect tickets **strictly on-demand** when requested by the user and confirmed active.
2. **Superset Headless BI Agent (`superset-agent`)**:
   - Interacts directly with Superset backend (`/api/v1/chart/data`), bypassing the frontend.
   - Uses Data Catalog MCP to discover table schemas and columns.
   - Projects interactive ECharts widgets to the canvas.

### B. Dynamic Instruction Editor
- Both agents have editable system instruction sets stored in the `agent_personas` database table.
- Accessible directly from the User Avatar Dropdown under **"Agent Instructions"**.
- Customizations persist across sessions and take effect on subsequent conversation turns.

### C. Persistent Local Repository Storage
- Repositories are cloned (full or shallow) into persistent storage at `/local_data/repos/{repo_name}`.
- The `local_repositories` database table indexes paths, remote URLs, and default branches.
- Once cloned, the GitHub Agent runs sub-second git operations and code inspections without re-downloading.

### D. Google Material 3 Dark Theme
- Toggleable directly in the top app bar via Sun/Moon icons.
- Complete dark palette implementation with M3 surface elevations (`#141218`, `#1D1B20`, `#211F26`, `#2B2930`).
- State persisted automatically in `localStorage`.
