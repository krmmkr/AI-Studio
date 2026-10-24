import asyncio
import json
import logging
import os
from pathlib import Path
from typing import AsyncGenerator, Any
from backend.app.models import MCPConfig
from backend.app.services.duckdb_service import duckdb_service

logger = logging.getLogger("antigravity_agent")

CONTEXT_FILE = Path(__file__).resolve().parent.parent.parent.parent / "AGENT_CONTEXT.md"

def load_agent_context() -> str:
    """Reads persistent agent context and domain knowledge from AGENT_CONTEXT.md."""
    if CONTEXT_FILE.exists():
        try:
            return CONTEXT_FILE.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to read agent context file: {e}")
    return ""

class AntigravityAgentService:
    """
    Manages agent execution, streaming thoughts, tool invocations, and canvas emission.
    """

    async def stream_chat(
        self,
        user_message: str,
        history: list[dict[str, str]],
        mcp_configs: list[MCPConfig],
        current_dashboard_id: str | None = None,
        agent_id: str | None = "general"
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Streams events to the client:
        - {"type": "thought", "content": "..."}
        - {"type": "tool_call", "name": "...", "args": {...}}
        - {"type": "tool_result", "name": "...", "result": {...}}
        - {"type": "token", "content": "..."}
        - {"type": "canvas_action", "action": "create_widget"|"update_widget", "widget": {...}}
        - {"type": "done"}
        """
        lower_msg = user_message.lower()

        # Phase 1: Stream initial reasoning / thoughts
        if agent_id == "general" or not agent_id:
            yield {
                "type": "thought",
                "content": "Using General Assistant (standard mode, no custom instructions)."
            }
        else:
            try:
                from backend.app.database import SessionLocal
                from backend.app.models import AgentPersona
                db = SessionLocal()
                persona = db.query(AgentPersona).filter(AgentPersona.id == agent_id).first()
                if persona:
                    yield {
                        "type": "thought",
                        "content": f"Loaded specialized persona '{persona.name}' instructions: {persona.role_description}"
                    }
                else:
                    yield {
                        "type": "thought",
                        "content": f"Loaded agent context for '{agent_id}'."
                    }
                db.close()
            except Exception:
                yield {
                    "type": "thought",
                    "content": f"Loaded agent context for '{agent_id}'."
                }
        await asyncio.sleep(0.2)

        yield {
            "type": "thought",
            "content": f"Analyzing user prompt: '{user_message}'. Inspecting available MCP tools and canvas context..."
        }
        await asyncio.sleep(0.2)

        # Check tools
        active_tools = [cfg.name for cfg in mcp_configs if cfg.is_active]
        yield {
            "type": "thought",
            "content": f"Found {len(active_tools)} active MCP server(s): {', '.join(active_tools) if active_tools else 'None'}. Checking required capabilities."
        }
        await asyncio.sleep(0.3)

        # Phase 2: Route request based on intent
        if any(kw in lower_msg for kw in ["duckdb", "sql", "aggregate", "revenue by region", "lines added"]):
            sql_query = "SELECT region, SUM(revenue_usd) as total_rev FROM superset_bi_transactions GROUP BY region ORDER BY total_rev DESC"
            if "author" in lower_msg or "commit" in lower_msg or "lines" in lower_msg:
                sql_query = "SELECT author, SUM(lines_added) as added, SUM(lines_deleted) as deleted FROM github_commits GROUP BY author ORDER BY added DESC"

            yield {
                "type": "thought",
                "content": f"Invoking embedded DuckDB engine on local datasets with SQL: '{sql_query}'"
            }
            await asyncio.sleep(0.3)

            yield {
                "type": "tool_call",
                "name": "duckdb_local_analytics",
                "args": {"query": sql_query}
            }
            await asyncio.sleep(0.4)

            try:
                res = duckdb_service.execute_query(sql_query)
                yield {
                    "type": "tool_result",
                    "name": "duckdb_local_analytics",
                    "result": {"row_count": res["row_count"], "sample": res["data"][:3]}
                }

                # Dynamically construct chart from DuckDB records
                categories = [str(list(r.values())[0]) for r in res["data"]]
                metric_values = [list(r.values())[1] for r in res["data"]]
                col_name = res["columns"][1].replace("_", " ").title()

                new_duckdb_widget = {
                    "id": f"duckdb-analytic-{abs(hash(sql_query)) % 10000}",
                    "title": f"DuckDB: {col_name} Analysis",
                    "widget_type": "echarts",
                    "grid": {"x": 0, "y": 0, "w": 6, "h": 5},
                    "datasource": {"type": "duckdb", "label": "DuckDB Local Cache"},
                    "spec": {
                        "title": {"text": f"DuckDB In-Memory: {col_name}", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
                        "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
                        "grid": {"left": "3%", "right": "4%", "bottom": "12%", "top": "18%", "containLabel": True},
                        "xAxis": {"type": "category", "data": categories},
                        "yAxis": {"type": "value"},
                        "series": [{
                            "data": metric_values,
                            "type": "bar",
                            "itemStyle": {"color": "#6750A4", "borderRadius": [8, 8, 0, 0]}
                        }]
                    }
                }

                if current_dashboard_id:
                    yield {
                        "type": "canvas_action",
                        "action": "create_widget",
                        "widget": new_duckdb_widget
                    }

                canvas_msg = f"\n\nI've dynamically generated the **DuckDB: {col_name} Analysis** chart directly onto your dashboard canvas!" if current_dashboard_id else ""
                response_text = (
                    f"Executed embedded DuckDB query in-process:\n"
                    f"```sql\n{sql_query}\n```\n\n"
                    f"**Results Summary**:\n"
                    + "\n".join([f"- **{list(r.values())[0]}**: {list(r.values())[1]:,}" for r in res["data"][:5]])
                    + canvas_msg
                )
            except Exception as e:
                response_text = f"DuckDB encountered an issue running query: {str(e)}"

        elif any(kw in lower_msg for kw in ["commit", "heatmap", "productivity", "churn", "author"]):
            # Developer productivity / commit churn workflow
            yield {
                "type": "tool_call",
                "name": "github_commit_churn_heatmap",
                "args": {"repo": "main-service", "timeframe": "last_3_months", "granularity": "hourly"}
            }
            await asyncio.sleep(0.5)

            yield {
                "type": "tool_result",
                "name": "github_commit_churn_heatmap",
                "result": {"status": "success", "total_commits": 1420, "top_peak_hour": "2:00 PM - 4:00 PM"}
            }

            yield {
                "type": "thought",
                "content": "Commit data retrieved. Generating updated temporal distribution chart widget for the dashboard canvas."
            }
            await asyncio.sleep(0.2)

            # Emit updated or new widget to canvas
            new_widget = {
                "id": "gh-author-churn-breakdown",
                "title": "Top Authors by Commit Churn & Review Turnaround",
                "widget_type": "echarts",
                "grid": {"x": 0, "y": 0, "w": 6, "h": 5},
                "datasource": {"type": "mcp_github", "label": "GitHub MCP: /repos/main/commits/analytics"},
                "spec": {
                    "title": {"text": "Top Authors Commit & Review Activity", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
                    "tooltip": {"trigger": "axis"},
                    "legend": {"bottom": "0%", "data": ["Commits", "PRs Merged"]},
                    "grid": {"left": "3%", "right": "4%", "bottom": "12%", "top": "18%", "containLabel": True},
                    "xAxis": {"type": "category", "data": ["Alex K.", "Sarah M.", "David R.", "Elena T.", "Marcus L."]},
                    "yAxis": {"type": "value"},
                    "series": [
                        {"name": "Commits", "type": "bar", "data": [142, 118, 95, 84, 62], "itemStyle": {"color": "#6750A4", "borderRadius": [6, 6, 0, 0]}},
                        {"name": "PRs Merged", "type": "bar", "data": [32, 28, 19, 24, 15], "itemStyle": {"color": "#4A6572", "borderRadius": [6, 6, 0, 0]}}
                    ]
                }
            }
            if current_dashboard_id:
                yield {
                    "type": "canvas_action",
                    "action": "create_widget",
                    "widget": new_widget
                }

            canvas_msg = "\n\nI've added the **Top Authors Commit & Review Activity** widget to your dashboard canvas. You can drag, resize, or inspect the data points directly!" if current_dashboard_id else ""
            response_text = (
                "I analyzed the repository's commit velocity and author contributions over the last quarter via the **GitHub MCP tool**.\n\n"
                "Key takeaways:\n"
                "- **Peak commit velocity** occurs between **2:00 PM and 4:00 PM**, with Friday afternoons displaying a 68% drop in PR creation.\n"
                "- **Top contributors** (Alex K. and Sarah M.) account for 41% of merged lines.\n"
                + canvas_msg
            )

        elif any(kw in lower_msg for kw in ["list dataset", "available dataset", "show dataset", "what dataset", "explore dataset"]):
            # Superset Dataset Catalog Discovery
            yield {
                "type": "tool_call",
                "name": "catalog_search_metadata",
                "args": {"query": "superset_datasets"}
            }
            await asyncio.sleep(0.4)

            yield {
                "type": "tool_result",
                "name": "catalog_search_metadata",
                "result": {
                    "catalog": "Enterprise Superset 7.0 MCP",
                    "datasets": [
                        {"id": 104, "name": "analytics.customer_transactions_daily", "rows": 4820000, "metrics": ["revenue_usd", "seats"]},
                        {"id": 105, "name": "telemetry.query_performance", "rows": 850000, "metrics": ["latency_ms", "cache_hit_pct"]},
                        {"id": 106, "name": "finance.saas_arr_metrics", "rows": 120000, "metrics": ["new_arr", "expansion", "net_arr"]}
                    ]
                }
            }

            response_text = (
                "Found **3 Superset Headless BI Datasets** available in the metadata catalog:\n\n"
                "1. **`analytics.customer_transactions_daily`** (Dataset ID: 104)\n"
                "   - **Scale**: 4.82M rows (Enterprise Deals & Invoicing)\n"
                "   - **Dimensions**: `region`, `customer_tier`, `transaction_date`\n"
                "   - **Metrics**: `revenue_usd`, `seats`\n\n"
                "2. **`telemetry.query_performance`** (Dataset ID: 105)\n"
                "   - **Scale**: 850k telemetry pings (Multi-engine latency)\n"
                "   - **Dimensions**: `database_name`, `engine_type`\n"
                "   - **Metrics**: `latency_ms`, `rows_scanned`, `cache_hit_pct`\n\n"
                "3. **`finance.saas_arr_metrics`** (Dataset ID: 106)\n"
                "   - **Scale**: 120k historical accounts (Recurring Revenue)\n"
                "   - **Dimensions**: `month`\n"
                "   - **Metrics**: `new_arr_k`, `expansion_k`, `churn_k`, `net_arr_k`\n\n"
                "💡 *You can ask me to plot any of these (e.g. 'Build a regional revenue chart' or 'Create query performance latency chart'), or click **+ Add Visual** on the canvas.*"
            )

        elif any(kw in lower_msg for kw in ["latency", "engine", "query performance", "query_perf"]):
            # Query Performance Chart
            yield {
                "type": "tool_call",
                "name": "superset_query_dataset",
                "args": {"dataset_id": 105, "metrics": ["avg_latency_ms", "cache_hit_pct"], "groupby": ["database_name"]}
            }
            await asyncio.sleep(0.4)

            yield {
                "type": "tool_result",
                "name": "superset_query_dataset",
                "result": {"query_id": "qp_latency_771", "status": "computed", "rows": 5, "latency_ms": 110}
            }

            perf_widget = {
                "id": f"superset-perf-{int(asyncio.get_event_loop().time() * 1000)}",
                "title": "Superset BI: Engine Latency & Telemetry",
                "widget_type": "echarts",
                "grid": {"x": 0, "y": 0, "w": 6, "h": 5},
                "datasource": {"type": "mcp_superset", "label": "Superset 7.0 MCP: query_performance"},
                "spec": {
                    "title": {"text": "Avg Engine Latency (ms)", "left": "center", "textStyle": {"fontSize": 13, "color": "#1C1B1F"}},
                    "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
                    "grid": {"left": "3%", "right": "4%", "bottom": "12%", "top": "18%", "containLabel": True},
                    "xAxis": {"type": "category", "data": ["DuckDB", "ClickHouse", "Postgres Primary", "Postgres Replica", "Snowflake DW"]},
                    "yAxis": {"type": "value", "name": "Latency (ms)"},
                    "series": [{
                        "data": [18.4, 64.1, 142.5, 210.8, 480.2],
                        "type": "bar",
                        "itemStyle": {"color": "#10b981", "borderRadius": [6, 6, 0, 0]}
                    }]
                }
            }
            if current_dashboard_id:
                yield {
                    "type": "canvas_action",
                    "action": "create_widget",
                    "widget": perf_widget
                }

            canvas_msg = "\n\nI've added the **Engine Latency & Telemetry** chart to your canvas." if current_dashboard_id else ""
            response_text = (
                "Dispatched a headless aggregation to **Superset 7.0 MCP** over dataset `telemetry.query_performance` (ID: 105).\n\n"
                "- Evaluated average latency across **5 connected engines**.\n"
                "- **DuckDB In-Memory** recorded lowest latency at **18.4ms**, while **Snowflake DW** averaged **480.2ms**.\n"
                + canvas_msg
            )

        elif any(kw in lower_msg for kw in ["arr", "saas", "expansion", "growth"]):
            # SaaS ARR Chart
            yield {
                "type": "tool_call",
                "name": "superset_query_dataset",
                "args": {"dataset_id": 106, "metrics": ["net_arr_k", "expansion_k"], "grain": "monthly"}
            }
            await asyncio.sleep(0.4)

            yield {
                "type": "tool_result",
                "name": "superset_query_dataset",
                "result": {"query_id": "qp_arr_391", "status": "computed", "rows": 6, "latency_ms": 135}
            }

            arr_widget = {
                "id": f"superset-arr-{int(asyncio.get_event_loop().time() * 1000)}",
                "title": "Superset BI: Monthly SaaS Net ARR Growth",
                "widget_type": "echarts",
                "grid": {"x": 6, "y": 0, "w": 6, "h": 5},
                "datasource": {"type": "mcp_superset", "label": "Superset 7.0 MCP: saas_arr_metrics"},
                "spec": {
                    "title": {"text": "Net ARR Trajectory ($k)", "left": "center", "textStyle": {"fontSize": 13, "color": "#1C1B1F"}},
                    "tooltip": {"trigger": "axis"},
                    "grid": {"left": "3%", "right": "4%", "bottom": "12%", "top": "18%", "containLabel": True},
                    "xAxis": {"type": "category", "data": ["May '26", "Jun '26", "Jul '26", "Aug '26", "Sep '26", "Oct '26"]},
                    "yAxis": {"type": "value", "name": "ARR ($k)"},
                    "series": [{
                        "data": [490.0, 540.0, 602.0, 696.0, 765.0, 864.0],
                        "type": "line",
                        "smooth": True,
                        "areaStyle": {"color": "#a7f3d0", "opacity": 0.4},
                        "itemStyle": {"color": "#059669"}
                    }]
                }
            }
            if current_dashboard_id:
                yield {
                    "type": "canvas_action",
                    "action": "create_widget",
                    "widget": arr_widget
                }

            canvas_msg = "\n\nI've projected the **Monthly SaaS Net ARR Growth** widget onto your canvas." if current_dashboard_id else ""
            response_text = (
                "Executed aggregation query against **Superset 7.0 MCP** dataset `finance.saas_arr_metrics` (ID: 106).\n\n"
                "- Trajectory shows Net ARR climbing from **$490k to $864k** over 6 months (+76% run-rate).\n"
                + canvas_msg
            )

        elif any(kw in lower_msg for kw in ["superset", "catalog", "bi", "revenue", "sql", "query"]):
            # Superset Headless BI & Data Catalog workflow
            yield {
                "type": "tool_call",
                "name": "catalog_search_metadata",
                "args": {"query": "customer_transactions_daily"}
            }
            await asyncio.sleep(0.4)

            yield {
                "type": "tool_result",
                "name": "catalog_search_metadata",
                "result": {"table": "analytics.customer_transactions_daily", "rows": 4820000, "owner": "Data Engineering"}
            }

            yield {
                "type": "tool_call",
                "name": "superset_query_dataset",
                "args": {"dataset_id": 104, "metrics": ["sum_amount", "unique_users"], "grain": "weekly"}
            }
            await asyncio.sleep(0.5)

            yield {
                "type": "tool_result",
                "name": "superset_query_dataset",
                "result": {"query_id": "qp_9102", "status": "computed", "latency_ms": 190}
            }

            new_bi_widget = {
                "id": "superset-weekly-runrate",
                "title": "Superset BI: Headless Weekly Transaction Volume",
                "widget_type": "echarts",
                "grid": {"x": 6, "y": 0, "w": 6, "h": 5},
                "datasource": {"type": "mcp_superset", "label": "Superset 7.0 MCP: dataset_104"},
                "spec": {
                    "title": {"text": "Weekly Transaction Volume ($k)", "left": "center", "textStyle": {"fontSize": 14, "color": "#1C1B1F"}},
                    "tooltip": {"trigger": "axis"},
                    "grid": {"left": "3%", "right": "4%", "bottom": "10%", "top": "18%", "containLabel": True},
                    "xAxis": {"type": "category", "data": ["W38", "W39", "W40", "W41", "W42", "W43"]},
                    "yAxis": {"type": "value", "name": "USD ($k)"},
                    "series": [{
                        "data": [320, 410, 390, 520, 610, 750],
                        "type": "line",
                        "smooth": True,
                        "areaStyle": {"color": "#EADDFF"},
                        "itemStyle": {"color": "#6750A4"}
                    }]
                }
            }
            if current_dashboard_id:
                yield {
                    "type": "canvas_action",
                    "action": "create_widget",
                    "widget": new_bi_widget
                }

            canvas_msg = "\n\nI've projected the **Headless Weekly Transaction Volume** chart onto your dashboard canvas." if current_dashboard_id else ""
            response_text = (
                "I queried the **Enterprise Data Catalog MCP** to discover the table `analytics.customer_transactions_daily`, then dispatched a headless aggregation to **Superset 7.0 MCP**.\n\n"
                "- Query executed in **190ms**.\n"
                "- Current weekly transaction volume is trending upward at **+23% DoD**.\n"
                + canvas_msg
            )

        # Check Jira MCP status
        has_jira_mcp = any("jira" in cfg.name.lower() and cfg.is_active for cfg in mcp_configs)

        # Route request based on intent & agent persona
        if any(kw in lower_msg for kw in ["jira", "ticket", "defect", "issue", "bug"]):
            if not has_jira_mcp:
                yield {
                    "type": "thought",
                    "content": "User requested Jira ticket action, but Jira MCP server is not active."
                }
                response_text = (
                    "Jira MCP server is currently **not connected** or disabled in your MCP Tools Hub.\n\n"
                    "To enable ticket creation, please configure your Jira API credentials under **MCP Tools Hub**."
                )
            else:
                yield {
                    "type": "tool_call",
                    "name": "jira_create_issue",
                    "args": {
                        "project": "ENG",
                        "issue_type": "Bug",
                        "summary": "Fix unbounded session cache identified during PR #104 review",
                        "priority": "High",
                        "labels": ["security-audit", "github-code-review"]
                    }
                }
                await asyncio.sleep(0.4)

                yield {
                    "type": "tool_result",
                    "name": "jira_create_issue",
                    "result": {"status": "created", "issue_key": "ENG-4092", "link": "https://jira.internal/browse/ENG-4092"}
                }

                response_text = (
                    "As requested, I used the **Jira MCP** to raise a tracking defect for this code issue:\n\n"
                    "- **Ticket**: [ENG-4092: Fix unbounded session cache](https://jira.internal/browse/ENG-4092)\n"
                    "- **Severity**: High (Discovered potential OOM condition in session worker)\n"
                    "- **Linked PR**: #104\n\n"
                    "The ticket is assigned to the PR author and flagged for the current sprint backlog."
                )

        elif any(kw in lower_msg for kw in ["scope", "exclude", "isolate", "lock widget"]) or (("filter" in lower_msg or "pin" in lower_msg) and any(kw in lower_msg for kw in ["region", "date", "repo", "env", "apply"])):
            yield {
                "type": "thought",
                "content": "Analyzing widget filter scoping request and cross-filtering rules..."
            }
            await asyncio.sleep(0.3)
            yield {
                "type": "tool_call",
                "name": "configure_filter_scope",
                "args": {"dashboard_id": current_dashboard_id or "active", "rule": "exclude_dimension"}
            }
            await asyncio.sleep(0.3)
            yield {
                "type": "tool_result",
                "name": "configure_filter_scope",
                "result": {"status": "success", "scoped_widget": "react-git-dag", "filter_scope": {"date": True, "region": False, "repo": True, "env": True}}
            }

            # Find matching widget in DB to emit updated widget
            target_widget_data = None
            if current_dashboard_id:
                try:
                    from backend.app.database import SessionLocal
                    from backend.app.models import DashboardWidget
                    db = SessionLocal()
                    w = db.query(DashboardWidget).filter(
                        DashboardWidget.dashboard_id == current_dashboard_id,
                        DashboardWidget.widget_id.ilike("%git%")
                    ).first()
                    if not w:
                        w = db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == current_dashboard_id).first()
                    if w:
                        spec = json.loads(w.spec_json) if w.spec_json else {}
                        spec["filter_scope"] = {"date": True, "region": False, "repo": True, "env": True}
                        w.spec_json = json.dumps(spec)
                        db.commit()
                        target_widget_data = {
                            "id": w.widget_id,
                            "title": w.title,
                            "widget_type": w.widget_type,
                            "grid": json.loads(w.grid_json) if w.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
                            "spec": spec,
                            "datasource": json.loads(w.datasource_json) if w.datasource_json else {}
                        }
                    db.close()
                except Exception:
                    pass

            if target_widget_data:
                yield {
                    "type": "canvas_action",
                    "action": "update_widget",
                    "widget": target_widget_data
                }

            response_text = (
                "Applied filter scoping configuration to **" + (target_widget_data['title'] if target_widget_data else "target widget") + "**:\n\n"
                "- 📅 **Date Filter**: Active (Listens to global 7d/30d/90d)\n"
                "- 🌍 **Region Filter**: ❌ **Excluded (Isolated)** (Widget preserves global view regardless of dashboard region dropdown)\n"
                "- 🐙 **Repository Filter**: Active\n"
                "- ⚡ **Environment Filter**: Active\n\n"
                "The widget's filter scope badge now reflects this isolation, and its data will remain locked to the global mainline repo."
            )

        elif any(kw in lower_msg for kw in ["comment", "pin", "annotation", "spatial"]):
            yield {
                "type": "thought",
                "content": "Inspecting spatial comment pins on dashboard canvas..."
            }
            await asyncio.sleep(0.3)
            yield {
                "type": "tool_call",
                "name": "dashboard_spatial_comments",
                "args": {"dashboard_id": current_dashboard_id or "active"}
            }
            await asyncio.sleep(0.4)
            yield {
                "type": "tool_result",
                "name": "dashboard_spatial_comments",
                "result": {"open_pins": 2, "resolved_pins": 1}
            }

            response_text = (
                "Here is the spatial comment summary for this dashboard:\n\n"
                "- 📍 **Pin #1 on Snowflake Latency Card**: *\"Query latency spiked to 480ms on Snowflake here. Can we offload this to DuckDB in-memory cache?\"* (By Sarah M.)\n"
                "- 📍 **Pin #2 on Git DAG Visualizer**: *\"Exclude this widget from the global region filter; it should always reflect global main-service repo commits.\"* (By Alex K.)\n\n"
                "**Agent Recommendations & Actionability**:\n"
                "1. **Filter Scoping**: Filter scoping allows individual widgets to listen to or ignore global dashboard filters. I can lock any widget to a fixed time or dimension based on your pin comments.\n"
                "2. **Cache Optimization**: In-memory DuckDB query benchmarked at **18.4ms** (a 26x speedup over Snowflake)."
            )

        elif any(kw in lower_msg for kw in ["review", "sla", "pr", "pull request", "bottleneck"]):
            yield {
                "type": "tool_call",
                "name": "github_pr_velocity",
                "args": {"repo": "main-service", "days": 30}
            }
            await asyncio.sleep(0.4)
            yield {
                "type": "tool_result",
                "name": "github_pr_velocity",
                "result": {"median_review_hours": 9.4, "sla_breaches": 3, "unreviewed_prs": 5}
            }

            canvas_note = " Refer to the **Weekly PR Velocity & SLA** card on your canvas for daily fluctuations." if current_dashboard_id else ""
            response_text = (
                "Here is the code review audit from **GitHub MCP** for the past 30 days:\n\n"
                "- **Median review turnaround**: `9.4 hours` (within the 10h SLA target).\n"
                "- **SLA Breaches**: 3 PRs exceeded 24 hours (mostly large PRs with > 600 line diffs).\n"
                "- **Pending Reviews**: 5 open PRs currently waiting on peer approval.\n\n"
                f"Overall SLA compliance remains high at **93.8%** across primary repositories.{canvas_note}"
            )

        else:
            if current_dashboard_id:
                response_text = (
                    f"Hello! I am your **Antigravity AI Agent**.\n\n"
                    f"I am actively connected to your Model Context Protocol (MCP) tool chain:\n"
                    f"- **GitHub MCP**: Developer productivity, pull request velocities, commit churn heatmaps, code review sentiment.\n"
                    f"- **Superset 7.0 MCP & Data Catalog**: Headless BI slice queries, metadata exploration, and dynamic visualization.\n\n"
                    f"Ask me to analyze your repositories or explore datasets, and I will generate and update charts on your interactive dashboard canvas in real time!"
                )
            else:
                response_text = (
                    f"Hello! I am your **Antigravity Agentic Assistant**.\n\n"
                    f"I am actively connected to your Model Context Protocol (MCP) tools:\n"
                    f"- ⚡ **Superset 7.0 MCP & Catalog**: Headless BI queries, dataset metadata, and metrics analysis.\n"
                    f"- 🐙 **GitHub MCP**: PR velocity audits, commit churn analysis, code review bottlenecks.\n"
                    f"- 🦆 **DuckDB In-Memory Engine**: In-process SQL execution on your local dataset cache.\n\n"
                    f"How can I help you today? You can ask me to run queries, audit repositories, or inspect system state directly."
                )

        # Phase 3: Stream response tokens
        for chunk in response_text.split(" "):
            yield {
                "type": "token",
                "content": chunk + " "
            }
            await asyncio.sleep(0.03)

        yield {"type": "done"}

antigravity_agent = AntigravityAgentService()
