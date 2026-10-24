# Agent Context & Persistent Knowledge Base

This file serves as the **reusable domain memory** for the Antigravity Agent. It is automatically loaded into the agent's system instructions, ensuring the agent never has to re-learn organizational conventions, schema structures, or code review rules.

---

## 1. GitHub Engineering Context

### Primary Repositories
- **`main-service`**: Core business backend (FastAPI / Python 3.12).
  - Code review SLA: **10 hours max**.
  - Strict rule: All DB operations must use parameterized queries; no raw string formatting.
- **`data-pipeline`**: ETL / streaming analytics pipelines.
- **`auth-proxy`**: Security gateway, handles OIDC / JWT validation.

### Code Review Standards & Triage
- PR diff size thresholds:
  - Small: `< 150 lines` (1 approval required).
  - Medium: `150 - 500 lines` (2 approvals required).
  - High risk: `> 500 lines` (Architectural review + automated security scan required).
- When a critical vulnerability or functional defect is identified during review:
  - If **Jira MCP** is connected, suggest creating a defect ticket with label `security-bug` or `code-quality`.

---

## 2. Superset Headless BI & Data Catalog Context

### Direct Headless BI Flow
- **Superset Backend Endpoint**: Direct execution via Superset MCP (`/api/v1/chart/data` and `/api/v1/sqllab/execute/`).
- **No Superset UI**: The Antigravity Canvas is the official presentation and interactive dashboard surface.

### Semantic Data Catalog Mappings
- **Customer Transactions**:
  - Catalog Table: `analytics.customer_transactions_daily`
  - Key Metrics: `revenue_usd`, `seats`, `deal_count`
  - Dimensions: `region` (`North America`, `Europe`, `Asia-Pacific`, `Latin America`), `customer_tier` (`Enterprise`, `Growth`, `Starter`)
- **Developer Metrics**:
  - Catalog Table: `eng_metrics.pr_turnaround_daily`
  - Key Metrics: `hours_to_merge`, `unreviewed_count`, `sla_breaches`

---

## 3. Visualization Guidelines for the Canvas

- Charts must be emitted in declarative **Apache ECharts** format.
- Palette: Google Material 3 Expressive colors:
  - Primary metric: `#6750A4` (M3 Purple)
  - Secondary comparison: `#4A6572` / `#006A6A` (Teal/Indigo)
  - SLA breach / Error: `#B3261E`
- Every chart emitted onto the canvas should have:
  - A clean title centered at the top.
  - Interactive tooltips enabled (`trigger: "axis"` or `"item"`).
  - A datasource tag indicating whether it was derived from **GitHub MCP**, **Superset 7.0 MCP**, or **Local Git Clone**.
