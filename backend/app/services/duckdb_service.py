import duckdb
import os
import logging
from typing import Any
from backend.app.services.file_storage import get_user_storage_dir

logger = logging.getLogger("duckdb_service")

class DuckDBService:
    def __init__(self):
        # In-memory connection initialized with default sample data tables
        self._init_sample_tables()

    def _init_sample_tables(self):
        """Pre-populate sample virtual tables representing cached Superset & GitHub datasets."""
        con = duckdb.connect(database=":memory:")
        
        # Table 1: github_commits
        con.execute("""
            CREATE TABLE github_commits AS SELECT * FROM (
                VALUES 
                ('c101', 'Alex K.', 'main-service', 'fix: memory leak in session cache', 42, 12, '2026-10-18 09:30:00'::TIMESTAMP),
                ('c102', 'Sarah M.', 'main-service', 'feat: add MCP SSE transport layer', 180, 24, '2026-10-18 14:15:00'::TIMESTAMP),
                ('c103', 'Alex K.', 'data-pipeline', 'refactor: duckdb query engine integration', 95, 10, '2026-10-19 11:00:00'::TIMESTAMP),
                ('c104', 'David R.', 'main-service', 'test: add ECharts widget verification', 65, 5, '2026-10-19 15:45:00'::TIMESTAMP),
                ('c105', 'Elena T.', 'auth-proxy', 'sec: enforce trailing slash boundary checks', 34, 18, '2026-10-20 10:20:00'::TIMESTAMP),
                ('c106', 'Sarah M.', 'data-pipeline', 'perf: optimize parquet reading throughput', 210, 45, '2026-10-21 16:30:00'::TIMESTAMP),
                ('c107', 'Marcus L.', 'main-service', 'docs: update architecture and user dropdown guides', 25, 4, '2026-10-22 13:10:00'::TIMESTAMP),
                ('c108', 'Alex K.', 'main-service', 'feat: full dashboard showcase popup', 120, 15, '2026-10-23 11:00:00'::TIMESTAMP)
            ) as t(commit_id, author, repo, message, lines_added, lines_deleted, committed_at)
        """)

        # Table 2: superset_bi_transactions
        con.execute("""
            CREATE TABLE superset_bi_transactions AS SELECT * FROM (
                VALUES 
                ('tx_001', 'North America', 'Enterprise', 24500.0, 18, '2026-10-01'::DATE),
                ('tx_002', 'Europe', 'Enterprise', 19800.0, 22, '2026-10-03'::DATE),
                ('tx_003', 'Asia-Pacific', 'Growth', 12400.0, 15, '2026-10-06'::DATE),
                ('tx_004', 'North America', 'Strategic', 45000.0, 35, '2026-10-10'::DATE),
                ('tx_005', 'Europe', 'Growth', 15600.0, 19, '2026-10-14'::DATE),
                ('tx_006', 'Latin America', 'Starter', 6200.0, 8, '2026-10-17'::DATE),
                ('tx_007', 'North America', 'Enterprise', 32000.0, 24, '2026-10-20'::DATE),
                ('tx_008', 'Asia-Pacific', 'Enterprise', 28500.0, 21, '2026-10-22'::DATE)
            ) as t(tx_id, region, customer_tier, revenue_usd, seats, transaction_date)
        """)

        # Table 3: superset_query_performance
        con.execute("""
            CREATE TABLE superset_query_performance AS SELECT * FROM (
                VALUES 
                ('qp_101', 'Postgres Primary', 'OLTP', 142.5, 45000, 98.2, '2026-10-23 18:00:00'::TIMESTAMP),
                ('qp_102', 'Snowflake DW', 'OLAP', 480.2, 1250000, 89.5, '2026-10-23 18:05:00'::TIMESTAMP),
                ('qp_103', 'DuckDB In-Memory', 'In-Process', 18.4, 82000, 99.8, '2026-10-23 18:10:00'::TIMESTAMP),
                ('qp_104', 'ClickHouse Live', 'Columnar', 64.1, 950000, 97.4, '2026-10-23 18:15:00'::TIMESTAMP),
                ('qp_105', 'Postgres Replica', 'OLTP', 210.8, 110000, 92.0, '2026-10-23 18:20:00'::TIMESTAMP)
            ) as t(query_id, database_name, engine_type, latency_ms, rows_scanned, cache_hit_pct, executed_at)
        """)

        # Table 4: superset_saas_metrics
        con.execute("""
            CREATE TABLE superset_saas_metrics AS SELECT * FROM (
                VALUES 
                ('2026-05', 420.0, 85.0, 15.0, 490.0, 1240),
                ('2026-06', 460.0, 92.0, 12.0, 540.0, 1380),
                ('2026-07', 510.0, 110.0, 18.0, 602.0, 1550),
                ('2026-08', 580.0, 130.0, 14.0, 696.0, 1790),
                ('2026-09', 640.0, 145.0, 20.0, 765.0, 2010),
                ('2026-10', 720.0, 160.0, 16.0, 864.0, 2350)
            ) as t(month, new_arr_k, expansion_k, churn_k, net_arr_k, active_customers)
        """)
        self.con = con

    def execute_query(self, sql: str, user_id: int | None = None, limit: int = 1000, offset: int = 0) -> dict[str, Any]:
        """
        Executes a SQL query safely via DuckDB with row limits and offset pagination.
        Restricts access to read-only queries.
        """
        stripped_sql = sql.strip().rstrip(";")
        upper_sql = stripped_sql.upper()

        # Security check: Disallow mutating or administrative commands
        disallowed_keywords = ["ATTACH", "COPY", "INSTALL", "LOAD", "PRAGMA", "EXPORT", "DROP", "ALTER", "DELETE", "INSERT", "UPDATE"]
        first_token = upper_sql.split()[0] if upper_sql.split() else ""
        if first_token in disallowed_keywords or any(kw in upper_sql for kw in ["DROP TABLE", "DELETE FROM", "INSERT INTO"]):
            raise ValueError(f"Only analytical read queries (SELECT / WITH) are permitted.")

        try:
            rel = self.con.execute(stripped_sql)
            columns = [desc[0] for desc in rel.description] if rel.description else []
            
            # Fetch rows and apply safe memory ceilings to protect browser and server
            all_rows = rel.fetchall()
            total_rows = len(all_rows)

            max_limit = min(limit if limit > 0 else 1000, 10000)
            paged_rows = all_rows[offset : offset + max_limit]
            is_truncated = total_rows > (offset + max_limit)

            # Format rows as list of dicts with JSON-safe primitives
            clean_rows = []
            for row in paged_rows:
                clean_row = {}
                for col, val in zip(columns, row):
                    if hasattr(val, "isoformat"):
                        clean_row[col] = val.isoformat()
                    elif isinstance(val, (int, float, str, bool)) or val is None:
                        clean_row[col] = val
                    else:
                        clean_row[col] = float(val) if hasattr(val, "__float__") else str(val)
                clean_rows.append(clean_row)

            return {
                "columns": columns,
                "total_rows": total_rows,
                "row_count": len(clean_rows),
                "data": clean_rows,
                "offset": offset,
                "limit": max_limit,
                "is_truncated": is_truncated,
                "sql": stripped_sql
            }
        except Exception as e:
            logger.error(f"DuckDB error: {e}")
            raise ValueError(f"DuckDB Query Execution Error: {str(e)}")

    def list_datasets(self) -> list[dict[str, Any]]:
        """List active tables and row counts in embedded DuckDB."""
        try:
            rel = self.con.execute("SHOW TABLES;").fetchall()
            results = []
            for (tbl_name,) in rel:
                count = self.con.execute(f"SELECT count(*) FROM {tbl_name};").fetchone()[0]
                cols = [desc[0] for desc in self.con.execute(f"SELECT * FROM {tbl_name} LIMIT 0;").description]
                is_superset = "superset" in tbl_name
                results.append({
                    "table_name": tbl_name,
                    "engine": "Superset Headless BI" if is_superset else "DuckDB In-Process",
                    "row_count": count,
                    "columns": cols,
                    "status": "cached",
                    "type": "virtual_dataset"
                })
            return results
        except Exception as e:
            logger.error(f"Failed to list duckdb tables: {e}")
            return []

duckdb_service = DuckDBService()
