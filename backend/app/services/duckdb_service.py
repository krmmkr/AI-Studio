import duckdb
import os
import logging
import threading
from typing import Any
from backend.app.services.file_storage import get_user_storage_dir
from backend.app.config import SEED_MOCK_DATA

logger = logging.getLogger("duckdb_service")

class DuckDBService:
    def __init__(self):
        self._lock = threading.RLock()
        self.dataset_lineage: dict[str, dict[str, Any]] = {}
        # In-memory connection initialized with default sample data tables
        self._init_sample_tables()

    def sync_derived_datasets(self):
        """Reloads any persisted derived datasets (.json, .parquet, .csv) and their lineage metadata from local_data/derived_datasets into memory."""
        try:
            import json
            from pathlib import Path
            ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
            if ds_dir.exists():
                with self._lock:
                    cur = self.con.cursor()
                    for f in ds_dir.iterdir():
                        if f.name.endswith(".meta.json") or f.name.startswith("."):
                            continue
                        tbl = f.stem
                        escaped = f.as_posix().replace("'", "''")
                        if f.suffix.lower() == ".parquet":
                            cur.execute(f"CREATE OR REPLACE TABLE {tbl} AS SELECT * FROM read_parquet('{escaped}');")
                        elif f.suffix.lower() == ".csv":
                            cur.execute(f"CREATE OR REPLACE TABLE {tbl} AS SELECT * FROM read_csv_auto('{escaped}');")
                        elif f.suffix.lower() == ".json":
                            cur.execute(f"CREATE OR REPLACE TABLE {tbl} AS SELECT * FROM read_json_auto('{escaped}');")

                        meta_file = ds_dir / f"{tbl}.meta.json"
                        if meta_file.exists():
                            try:
                                self.dataset_lineage[tbl] = json.loads(meta_file.read_text(encoding="utf-8"))
                            except Exception:
                                pass
                        elif tbl not in self.dataset_lineage:
                            inferred_repo = tbl.split("_")[0] if "_" in tbl else "workspace"
                            self.dataset_lineage[tbl] = {
                                "origin_type": "agent_derived",
                                "source_name": f"git:{inferred_repo}" if inferred_repo not in ("dataset", "custom", "user") else "DuckDB SQL Transform",
                                "derivation_summary": f"Agent-derived analytical view persisted as {f.suffix.lstrip('.').upper()}",
                                "source_query": f"SELECT * FROM {tbl}",
                                "storage_path": f"local_data/derived_datasets/{f.name}",
                            }
        except Exception as e:
            logger.warning(f"Notice while syncing derived datasets: {e}")

    def _init_sample_tables(self):
        """Initializes in-memory DuckDB connection and syncs user-created derived datasets."""
        with self._lock:
            con = duckdb.connect(database=":memory:")
            self.con = con
            self.sync_derived_datasets()
        self.con = con

    def execute_query(self, sql: str, user_id: int | None = None, limit: int = 1000, offset: int = 0) -> dict[str, Any]:
        """
        Executes a SQL query safely via DuckDB with row limits and offset pagination.
        Restricts access to read-only queries with strict validation against SQL injection,
        multi-statement execution, and unauthorized file system mutations.
        """
        import re
        # Remove single-line and multi-line comments
        no_comments = re.sub(r"--[^\n]*", "", sql)
        no_comments = re.sub(r"/\*.*?\*/", "", no_comments, flags=re.DOTALL)
        
        stripped_sql = no_comments.strip()
        if not stripped_sql:
            raise ValueError("Query string cannot be empty.")
            
        # Mask string literals and quoted identifiers before multi-statement and keyword analysis
        masked_sql = re.sub(r"'(''|[^'])*'", "'__STR__'", stripped_sql)
        masked_sql = re.sub(r'"(""|[^"])*"', '"__ID__"', masked_sql)

        # Disallow multi-statement execution (semicolons in body outside string literals)
        statements = [stmt.strip() for stmt in masked_sql.split(";") if stmt.strip()]
        if len(statements) > 1:
            raise ValueError("Multi-statement queries separated by semicolons are strictly prohibited.")

        single_query = stripped_sql
        tokens = statements[0].split()
        first_token = tokens[0].upper() if tokens else ""

        # Enforce that query strictly starts with analytical read keywords
        if first_token not in ("SELECT", "WITH", "EXPLAIN"):
            raise ValueError("Only analytical read queries starting with SELECT, WITH, or EXPLAIN are permitted.")

        # Disallowed keywords anywhere in the non-literal query structure
        upper_masked = statements[0].upper()
        disallowed_keywords = [
            "ATTACH", "COPY", "INSTALL", "LOAD", "PRAGMA", "EXPORT", "IMPORT",
            "DROP", "ALTER", "DELETE", "INSERT", "UPDATE", "CREATE", "CALL",
            "EXECUTE", "BEGIN", "COMMIT", "ROLLBACK", "CHECKPOINT", "FORCE",
            "VACUUM", "SET "
        ]
        for kw in disallowed_keywords:
            if kw.strip() == "PRAGMA":
                if re.search(r"\bPRAGMA\b|\bPRAGMA_", upper_masked):
                    raise ValueError("Prohibited SQL keyword detected: 'PRAGMA'. Only read-only queries are permitted.")
            elif re.search(r"\b" + re.escape(kw.strip()) + r"\b", upper_masked):
                raise ValueError(f"Prohibited SQL keyword detected: '{kw.strip()}'. Only read-only queries are permitted.")

        # Strip comments from original query to execute
        clean_exec_sql = single_query
        # If the query contains a semicolon at the end of the statement, strip trailing semicolons safely
        if ";" in clean_exec_sql:
            # Take only the first statement before the trailing semicolon
            clean_exec_sql = clean_exec_sql.rstrip().rstrip(";")

        try:
            with self._lock:
                cur = self.con.cursor()
                try:
                    rel = cur.execute(clean_exec_sql)
                except Exception as first_err:
                    # If table was not found, try syncing derived datasets or resolving staged proposal files
                    if "Table with name" in str(first_err) or "does not exist" in str(first_err):
                        self.sync_derived_datasets()
                        rewritten_sql = self._resolve_staged_tables_in_sql(clean_exec_sql)
                        rel = cur.execute(rewritten_sql)
                    else:
                        raise first_err

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

    def get_table_columns_map(self) -> dict[str, dict[str, str]]:
        """
        Dynamically introspects all tables/views from DuckDB's information_schema.
        Returns a mapping of {table_name: {column_name: data_type}}.
        """
        table_map: dict[str, dict[str, str]] = {}
        try:
            if hasattr(self, "con") and self.con:
                cur = self.con.cursor()
                rows = cur.execute(
                    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema IN ('main', 'public')"
                ).fetchall()
                for tbl, col, dtype in rows:
                    t = str(tbl).lower()
                    if t not in table_map:
                        table_map[t] = {}
                    table_map[t][str(col).lower()] = str(dtype).upper()
        except Exception as e:
            logger.debug(f"Could not read information_schema columns: {e}")
        return table_map

    def apply_filters_to_sql(self, base_sql: str, filters: dict[str, Any] | None = None, filter_scope: str = "global") -> str:
        """
        Dynamically applies cross-filtering parameters to an arbitrary DuckDB SQL query
        using schema inspection and subquery injection.
        
        Fully schema-driven and generic: matches any active filter parameter against
        the queried tables' columns (e.g. author, branch, commit_type, customer_tier,
        region, files_changed, lines_added, date, etc.) without requiring hardcoded lists.
        """
        if not filters or not isinstance(filters, dict) or filter_scope == "none":
            return base_sql

        import re
        sql = base_sql.strip()
        tables_map = self.get_table_columns_map()

        valid_intervals = {
            "24h": "1 day",
            "1d": "1 day",
            "7d": "7 days",
            "14d": "14 days",
            "30d": "30 days",
            "90d": "90 days",
            "1y": "365 days"
        }

        # Canonical dimension alias mappings
        DIMENSION_ALIASES = {
            "committer": "author",
            "author_name": "author",
            "user": "author",
            "repository": "repo",
            "repo_name": "repo",
            "git_branch": "branch",
            "type": "commit_type",
            "kind": "commit_type",
            "time_range": "date",
            "datefilter": "date",
            "min_churn": "min_lines",
        }

        # Normalize filter items
        normalized_filters: dict[str, Any] = {}
        for raw_k, raw_v in filters.items():
            if raw_v is None:
                continue
            v_str = str(raw_v).strip().lower()
            if v_str in ("all", "all repositories", "all authors", "all committers", "all branches", "all regions", "none", ""):
                continue
            k_clean = str(raw_k).strip().lower()
            target_key = DIMENSION_ALIASES.get(k_clean, k_clean)
            normalized_filters[target_key] = raw_v

        if not normalized_filters:
            return sql

        # Identify all tables referenced in base_sql
        for table_name, table_cols in tables_map.items():
            if not re.search(r"(?i)\b" + re.escape(table_name) + r"\b", sql):
                continue

            predicates: list[str] = []

            # 1. Date / time window filtering
            date_filter = normalized_filters.get("date")
            if date_filter:
                date_col = next(
                    (col for col, dtype in table_cols.items() if "TIMESTAMP" in dtype or "DATE" in dtype or col.endswith("_at") or col.endswith("_date")),
                    None
                )
                if date_col:
                    interval_str = valid_intervals.get(str(date_filter).strip().lower())
                    if interval_str:
                        predicates.append(
                            f"{date_col} >= ((SELECT COALESCE(MAX({date_col}), CURRENT_TIMESTAMP) FROM {table_name}) - INTERVAL '{interval_str}')"
                        )
                    elif str(date_filter).strip().lower() == "custom":
                        start_d = filters.get("start_date")
                        end_d = filters.get("end_date")
                        if start_d and re.match(r"^\d{4}-\d{2}-\d{2}$", str(start_d)):
                            predicates.append(f"{date_col} >= CAST('{start_d}' AS DATE)")
                        if end_d and re.match(r"^\d{4}-\d{2}-\d{2}$", str(end_d)):
                            predicates.append(f"{date_col} <= CAST('{end_d}' AS DATE)")

            # 2. Min lines / min churn filtering
            min_lines = normalized_filters.get("min_lines")
            if min_lines is not None:
                try:
                    num_lines = int(float(min_lines))
                    if num_lines > 0 and "lines_added" in table_cols:
                        if "lines_deleted" in table_cols:
                            predicates.append(f"(COALESCE(lines_added, 0) + COALESCE(lines_deleted, 0)) >= {num_lines}")
                        else:
                            predicates.append(f"COALESCE(lines_added, 0) >= {num_lines}")
                except (ValueError, TypeError):
                    pass

            # 3. Dynamic column-based filtering for all remaining matching fields
            for filter_key, filter_val in normalized_filters.items():
                if filter_key in ("date", "min_lines", "start_date", "end_date"):
                    continue

                if filter_key not in table_cols:
                    continue

                col_name = filter_key
                col_type = table_cols[col_name]

                # Array / multi-select filter
                if isinstance(filter_val, (list, tuple, set)):
                    clean_items = []
                    for item in filter_val:
                        if not item or str(item).lower() in ("all", "none"):
                            continue
                        safe_item = re.sub(r"['\\]", "", str(item)).strip()
                        if safe_item:
                            clean_items.append(safe_item)
                    if clean_items:
                        if len(clean_items) == 1:
                            predicates.append(f"{col_name} = '{clean_items[0]}'")
                        else:
                            in_list = ", ".join(f"'{x}'" for x in clean_items)
                            predicates.append(f"{col_name} IN ({in_list})")

                # Numeric range filter [min, max]
                elif isinstance(filter_val, (list, tuple)) and len(filter_val) == 2 and all(isinstance(x, (int, float)) for x in filter_val):
                    predicates.append(f"{col_name} >= {filter_val[0]} AND {col_name} <= {filter_val[1]}")

                # Numeric scalar filter
                elif isinstance(filter_val, (int, float)) and any(t in col_type for t in ("INT", "DOUBLE", "FLOAT", "BIGINT")):
                    predicates.append(f"{col_name} = {filter_val}")

                # String scalar filter
                elif isinstance(filter_val, str):
                    clean_str = re.sub(r"['\\]", "", filter_val).strip()
                    if clean_str:
                        if "%" in clean_str or "_" in clean_str:
                            predicates.append(f"LOWER({col_name}) LIKE LOWER('{clean_str}')")
                        else:
                            predicates.append(f"{col_name} = '{clean_str}'")

            if predicates:
                where_clause = " AND ".join(predicates)
                subquery = f"(SELECT * FROM {table_name} WHERE {where_clause})"
                sql = re.sub(r"(?i)\bFROM\s+" + re.escape(table_name) + r"\b", f"FROM {subquery} AS {table_name}", sql)
                sql = re.sub(r"(?i)\bJOIN\s+" + re.escape(table_name) + r"\b", f"JOIN {subquery} AS {table_name}", sql)

        return sql

        return sql

    def execute_widget_query(
        self,
        sql: str,
        filters: dict[str, Any] | None = None,
        filter_scope: str = "global",
        limit: int = 1000
    ) -> dict[str, Any]:
        """
        Executes an analytical widget query with optional cross-filter parameterization.
        Returns columns and rows cleanly for chart compilation with safe error fallback.
        """
        parameterized_sql = self.apply_filters_to_sql(sql, filters=filters, filter_scope=filter_scope)
        try:
            res = self.execute_query(parameterized_sql, limit=limit)
            return {
                "columns": res.get("columns", []),
                "data": res.get("data", []),
                "total_rows": res.get("total_rows", 0),
                "executed_sql": parameterized_sql,
                "base_sql": sql,
            }
        except Exception as e:
            logger.warning(f"Widget query execution error: {e} | SQL: {parameterized_sql}")
            return {
                "error": str(e),
                "columns": [],
                "data": [],
                "total_rows": 0,
                "executed_sql": parameterized_sql,
                "base_sql": sql,
            }

    def _resolve_staged_tables_in_sql(self, sql: str) -> str:
        """If a query references a table that is currently staged as a pending proposal (.staged_<tbl>.json), rewrite the FROM/JOIN reference to read_json_auto so previews and charts work before materialization."""
        import re
        from pathlib import Path
        ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
        if not ds_dir.exists():
            return sql
        rewritten = sql
        for f in ds_dir.glob(".staged_*.json"):
            if f.name.endswith(".meta.json"):
                continue
            tbl = f.name[len(".staged_") : -len(".json")]
            if not tbl:
                continue
            escaped = f.as_posix().replace("'", "''")
            rewritten = re.sub(
                r"(?i)\bFROM\s+" + re.escape(tbl) + r"\b",
                f"FROM read_json_auto('{escaped}') AS {tbl}",
                rewritten,
            )
            rewritten = re.sub(
                r"(?i)\bJOIN\s+" + re.escape(tbl) + r"\b",
                f"JOIN read_json_auto('{escaped}') AS {tbl}",
                rewritten,
            )
        return rewritten

    def stage_proposed_records(
        self,
        table_name: str,
        records: list[dict[str, Any]],
        description: str = "",
    ) -> dict[str, Any]:
        """Stages records for a proposed dataset (.staged_<table_name>.json) until the user approves materialization."""
        import re
        import json
        from pathlib import Path

        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", table_name).lower().strip("_")
        if not safe_name.isidentifier():
            safe_name = f"dataset_{safe_name}"
        if not records:
            return {"error": "No records provided to stage", "table_name": safe_name}

        ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
        ds_dir.mkdir(parents=True, exist_ok=True)
        staged_path = ds_dir / f".staged_{safe_name}.json"
        staged_path.write_text(json.dumps(records, indent=2, default=str), encoding="utf-8")
        cols = list(records[0].keys()) if isinstance(records[0], dict) else []
        return {
            "table_name": safe_name,
            "row_count": len(records),
            "columns": cols,
            "sample_rows": records[:5],
            "staged_path": staged_path.as_posix(),
        }

    def get_staged_records(self, table_name: str) -> list[dict[str, Any]] | None:
        """Retrieves staged records for a proposed dataset if present on disk."""
        import re
        import json
        from pathlib import Path

        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", table_name).lower().strip("_")
        if not safe_name.isidentifier():
            safe_name = f"dataset_{safe_name}"
        ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
        staged_path = ds_dir / f".staged_{safe_name}.json"
        if staged_path.exists():
            try:
                return json.loads(staged_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to read staged records for {safe_name}: {e}")
        return None

    def clear_staged_records(self, table_name: str) -> None:
        """Removes staged records file (.staged_<table_name>.json) after approval or decline."""
        import re
        from pathlib import Path

        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", table_name).lower().strip("_")
        if not safe_name.isidentifier():
            safe_name = f"dataset_{safe_name}"
        ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
        staged_path = ds_dir / f".staged_{safe_name}.json"
        if staged_path.exists():
            try:
                staged_path.unlink()
            except Exception:
                pass

    def list_datasets(self) -> list[dict[str, Any]]:
        """List active tables, row counts, and source lineage in embedded DuckDB."""
        try:
            self.sync_derived_datasets()
            results = []
            with self._lock:
                cur = self.con.cursor()
                rel = cur.execute("SHOW TABLES;").fetchall()
                for (tbl_name,) in rel:
                    count = cur.execute(f"SELECT count(*) FROM {tbl_name};").fetchone()[0]
                    cols = [desc[0] for desc in cur.execute(f"SELECT * FROM {tbl_name} LIMIT 0;").description]
                    is_superset = "superset" in tbl_name
                    lineage = self.dataset_lineage.get(tbl_name) or {
                        "origin_type": "agent_derived",
                        "source_name": "DuckDB Dynamic Dataset",
                        "derivation_summary": "Dynamic dataset materialized in DuckDB",
                        "source_query": f"SELECT * FROM {tbl_name}",
                    }
                    is_derived = True
                    results.append({
                        "table_name": tbl_name,
                        "engine": "Superset Headless BI" if is_superset else "Agent Derived View",
                        "row_count": count,
                        "columns": cols,
                        "status": "cached",
                        "type": "derived_dataset",
                        "is_derived": is_derived,
                        "lineage": lineage,
                    })
            return results
        except Exception as e:
            logger.error(f"Failed to list duckdb tables: {e}")
            return []

    def ingest_git_commits(self, repo_name: str, commits: list[dict[str, Any]]) -> int:
        """Ingest real git commits into the github_commits and github_contributors DuckDB tables."""
        if not commits:
            return 0
        try:
            with self._lock:
                cur = self.con.cursor()
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS github_commits (
                        commit_id VARCHAR,
                        author VARCHAR,
                        repo VARCHAR,
                        message VARCHAR,
                        lines_added INTEGER,
                        lines_deleted INTEGER,
                        committed_at TIMESTAMP,
                        commit_type VARCHAR DEFAULT 'other',
                        files_changed INTEGER DEFAULT 1,
                        branch VARCHAR DEFAULT 'main'
                    );
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS github_contributors (
                        repo VARCHAR,
                        author VARCHAR,
                        commits INTEGER,
                        lines_added BIGINT,
                        lines_deleted BIGINT,
                        net_lines BIGINT,
                        feat_count INTEGER,
                        fix_count INTEGER,
                        refactor_count INTEGER,
                        perf_count INTEGER,
                        chore_count INTEGER,
                        contribution_score INTEGER,
                        first_commit_at TIMESTAMP,
                        last_commit_at TIMESTAMP
                    );
                """)
                # Clear existing commits for this repo to avoid duplicates on re-sync
                cur.execute("DELETE FROM github_commits WHERE repo = ?", [repo_name])
                inserted = 0
                for c in commits:
                    cur.execute(
                        """
                        INSERT INTO github_commits (
                            commit_id, author, repo, message, lines_added, lines_deleted,
                            committed_at, commit_type, files_changed, branch
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?::TIMESTAMP, ?, ?, ?)
                        """,
                        [
                            str(c.get("commit_id", "")),
                            str(c.get("author", "Unknown")),
                            str(repo_name),
                            str(c.get("message", "")),
                            int(c.get("lines_added", 0)),
                            int(c.get("lines_deleted", 0)),
                            str(c.get("committed_at", "2026-01-01 00:00:00")),
                            str(c.get("commit_type", "other")),
                            int(c.get("files_changed", 1)),
                            str(c.get("branch", "main")),
                        ]
                    )
                    inserted += 1

                # Refresh contributor rollup for this repository
                cur.execute("DELETE FROM github_contributors WHERE repo = ?", [repo_name])
                cur.execute(
                    """
                    INSERT INTO github_contributors
                    SELECT
                        repo,
                        author,
                        COUNT(*) AS commits,
                        SUM(COALESCE(lines_added, 0)) AS lines_added,
                        SUM(COALESCE(lines_deleted, 0)) AS lines_deleted,
                        SUM(COALESCE(lines_added, 0) - COALESCE(lines_deleted, 0)) AS net_lines,
                        SUM(CASE WHEN commit_type = 'feat' THEN 1 ELSE 0 END) AS feat_count,
                        SUM(CASE WHEN commit_type = 'fix' THEN 1 ELSE 0 END) AS fix_count,
                        SUM(CASE WHEN commit_type = 'refactor' THEN 1 ELSE 0 END) AS refactor_count,
                        SUM(CASE WHEN commit_type = 'perf' THEN 1 ELSE 0 END) AS perf_count,
                        SUM(CASE WHEN commit_type IN ('chore', 'docs', 'test', 'other') THEN 1 ELSE 0 END) AS chore_count,
                        SUM(
                            CASE
                                WHEN commit_type IN ('feat', 'perf') THEN 3
                                WHEN commit_type IN ('fix', 'refactor') THEN 2
                                ELSE 1
                            END
                        ) AS contribution_score,
                        MIN(committed_at) AS first_commit_at,
                        MAX(committed_at) AS last_commit_at
                    FROM github_commits
                    WHERE repo = ?
                    GROUP BY repo, author
                    ORDER BY contribution_score DESC, lines_added DESC
                    """,
                    [repo_name],
                )
                logger.info(f"Ingested {inserted} real commits for repository '{repo_name}' into DuckDB.")
                return inserted
        except Exception as e:
            logger.error(f"Failed to ingest commits for {repo_name}: {e}")
            return 0

    def materialize_dataset(
        self,
        table_name: str,
        records: list[dict[str, Any]],
        replace: bool = True,
        lineage: dict[str, Any] | None = None,
        lineage_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Materializes an agent-derived or custom dataset as a first-class table in DuckDB,
        persisting it to `local_data/derived_datasets/{table_name}.json` along with `{table_name}.meta.json` lineage.
        """
        import re
        import json
        from datetime import datetime, timezone
        from pathlib import Path

        effective_lineage = lineage or lineage_meta or {}
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", table_name).lower().strip("_")
        if not safe_name.isidentifier():
            safe_name = f"dataset_{safe_name}"

        if not records:
            return {"status": "error", "success": False, "error": "No records provided to materialize"}

        try:
            ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
            ds_dir.mkdir(parents=True, exist_ok=True)
            file_path = ds_dir / f"{safe_name}.json"
            file_path.write_text(json.dumps(records, indent=2), encoding="utf-8")

            # Load into DuckDB using read_json_auto
            escaped_path = file_path.as_posix().replace("'", "''")
            with self._lock:
                cur = self.con.cursor()
                cur.execute(f"CREATE OR REPLACE TABLE {safe_name} AS SELECT * FROM read_json_auto('{escaped_path}');")
                count = cur.execute(f"SELECT count(*) FROM {safe_name};").fetchone()[0]
                cols = [desc[0] for desc in cur.execute(f"SELECT * FROM {safe_name} LIMIT 0;").description]

                # Export companion Parquet format for fast zero-copy scans
                parquet_path = ds_dir / f"{safe_name}.parquet"
                escaped_parquet = parquet_path.as_posix().replace("'", "''")
                try:
                    cur.execute(f"COPY {safe_name} TO '{escaped_parquet}' (FORMAT PARQUET);")
                except Exception as pe:
                    logger.debug(f"Parquet companion export notice: {pe}")

            inferred_repo = safe_name.split("_")[0] if "_" in safe_name else "workspace"
            meta_obj = {
                "origin_type": effective_lineage.get("origin_type") or "agent_derived",
                "source_name": effective_lineage.get("source_name") or f"git:{inferred_repo}",
                "derivation_summary": effective_lineage.get("derivation_summary")
                or f"Derived by Agent ({count} rows, {len(cols)} columns)",
                "source_query": effective_lineage.get("source_query")
                or f"SELECT {', '.join(cols)} FROM {safe_name}",
                "storage_path": f"local_data/derived_datasets/{safe_name}.parquet",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if effective_lineage.get("approved_by"):
                meta_obj["approved_by"] = effective_lineage["approved_by"]
            if effective_lineage.get("approved_at"):
                meta_obj["approved_at"] = effective_lineage["approved_at"]
            if effective_lineage.get("refresh_recipe"):
                meta_obj["refresh_recipe"] = effective_lineage["refresh_recipe"]
            if effective_lineage.get("contract_schema"):
                meta_obj["contract_schema"] = effective_lineage["contract_schema"]
            self.dataset_lineage[safe_name] = meta_obj
            meta_path = ds_dir / f"{safe_name}.meta.json"
            meta_path.write_text(json.dumps(meta_obj, indent=2), encoding="utf-8")
            self.clear_staged_records(safe_name)

            logger.info(f"Materialized derived dataset '{safe_name}' ({count} rows, cols: {cols}) from {file_path}.")
            return {
                "status": "success",
                "success": True,
                "table_name": safe_name,
                "row_count": count,
                "columns": cols,
                "file_path": file_path.as_posix(),
                "parquet_path": parquet_path.as_posix(),
                "lineage": meta_obj,
            }
        except Exception as e:
            logger.error(f"Failed to materialize dataset {safe_name}: {e}")
            return {"status": "error", "error": str(e)}

    def get_dataset_recipe(self, table_name: str) -> dict[str, Any] | None:
        """Retrieves the declarative generation recipe for an agent-derived dataset if available."""
        from pathlib import Path
        import json
        ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
        meta_path = ds_dir / f"{table_name.lower().strip()}.meta.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                return meta.get("refresh_recipe")
            except Exception:
                pass
        return None

    def import_file_dataset(self, filename: str, file_bytes: bytes, table_name: str | None = None) -> dict[str, Any]:
        """
        Saves an uploaded dataset file (.csv, .parquet, .json) to local_data/derived_datasets/
        and mounts it into DuckDB as a queryable relation.
        """
        import re
        from pathlib import Path

        p = Path(filename)
        ext = p.suffix.lower()
        if ext not in (".csv", ".parquet", ".json"):
            return {"status": "error", "error": f"Unsupported file extension '{ext}'. Supported formats: .csv, .parquet, .json"}

        raw_name = table_name.strip() if table_name and table_name.strip() else p.stem
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", raw_name).lower().strip("_")
        if not safe_name.isidentifier():
            safe_name = f"dataset_{safe_name}"

        try:
            ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
            ds_dir.mkdir(parents=True, exist_ok=True)
            saved_file = ds_dir / f"{safe_name}{ext}"
            saved_file.write_bytes(file_bytes)

            escaped = saved_file.as_posix().replace("'", "''")
            with self._lock:
                cur = self.con.cursor()
                if ext == ".parquet":
                    cur.execute(f"CREATE OR REPLACE TABLE {safe_name} AS SELECT * FROM read_parquet('{escaped}');")
                elif ext == ".csv":
                    cur.execute(f"CREATE OR REPLACE TABLE {safe_name} AS SELECT * FROM read_csv_auto('{escaped}');")
                else:
                    cur.execute(f"CREATE OR REPLACE TABLE {safe_name} AS SELECT * FROM read_json_auto('{escaped}');")

                count = cur.execute(f"SELECT count(*) FROM {safe_name};").fetchone()[0]
                cols = [desc[0] for desc in cur.execute(f"SELECT * FROM {safe_name} LIMIT 0;").description]

            import json
            from datetime import datetime, timezone
            meta_obj = {
                "origin_type": "file_upload",
                "source_name": f"file:{filename}",
                "derivation_summary": f"Uploaded {ext.lstrip('.').upper()} file ({count} rows)",
                "source_query": f"SELECT * FROM read_{ext.lstrip('.')}_auto('{saved_file.name}')",
                "storage_path": f"local_data/derived_datasets/{saved_file.name}",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            self.dataset_lineage[safe_name] = meta_obj
            (ds_dir / f"{safe_name}.meta.json").write_text(json.dumps(meta_obj, indent=2), encoding="utf-8")
            logger.info(f"Imported custom dataset '{safe_name}' ({count} rows, cols: {cols}) from {filename}.")
            return {
                "status": "success",
                "table_name": safe_name,
                "row_count": count,
                "columns": cols,
                "file_path": saved_file.as_posix(),
                "format": ext.lstrip("."),
                "lineage": meta_obj,
            }
        except Exception as e:
            logger.error(f"Failed to import dataset file '{filename}': {e}")
            return {"status": "error", "error": str(e)}

    def import_disk_dataset(self, disk_path: str, table_name: str | None = None) -> dict[str, Any]:
        """
        Loads a file residing directly on the VM / local filesystem into DuckDB.
        Copies it to local_data/derived_datasets/ for persistence across restarts.
        """
        import re
        import shutil
        from pathlib import Path

        p = Path(disk_path).resolve()
        if not p.exists() or not p.is_file():
            return {"status": "error", "error": f"File '{disk_path}' does not exist on disk."}

        # Restrict disk import to files residing within authorized local workspace directories
        from backend.app.config import BASE_DIR, LOCAL_DATA_DIR
        allowed_roots = [str(BASE_DIR.resolve()) + os.sep, str(LOCAL_DATA_DIR.resolve()) + os.sep]
        if not any(str(p).startswith(r) for r in allowed_roots):
            return {"status": "error", "error": "Access denied: disk_path must reside within the authorized workspace."}

        ext = p.suffix.lower()
        if ext not in (".csv", ".parquet", ".json"):
            return {"status": "error", "error": f"Unsupported format '{ext}'. Must be .csv, .parquet, or .json"}

        raw_name = table_name.strip() if table_name and table_name.strip() else p.stem
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", raw_name).lower().strip("_")
        if not safe_name.isidentifier():
            safe_name = f"dataset_{safe_name}"

        try:
            ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
            ds_dir.mkdir(parents=True, exist_ok=True)
            target_file = ds_dir / f"{safe_name}{ext}"
            if p != target_file:
                shutil.copyfile(p, target_file)

            escaped = target_file.as_posix().replace("'", "''")
            with self._lock:
                cur = self.con.cursor()
                if ext == ".parquet":
                    cur.execute(f"CREATE OR REPLACE TABLE {safe_name} AS SELECT * FROM read_parquet('{escaped}');")
                elif ext == ".csv":
                    cur.execute(f"CREATE OR REPLACE TABLE {safe_name} AS SELECT * FROM read_csv_auto('{escaped}');")
                else:
                    cur.execute(f"CREATE OR REPLACE TABLE {safe_name} AS SELECT * FROM read_json_auto('{escaped}');")

                count = cur.execute(f"SELECT count(*) FROM {safe_name};").fetchone()[0]
                cols = [desc[0] for desc in cur.execute(f"SELECT * FROM {safe_name} LIMIT 0;").description]

            logger.info(f"Imported disk dataset '{safe_name}' ({count} rows) from {disk_path}.")
            return {
                "status": "success",
                "table_name": safe_name,
                "row_count": count,
                "columns": cols,
                "file_path": target_file.as_posix(),
                "format": ext.lstrip(".")
            }
        except Exception as e:
            logger.error(f"Failed to import disk dataset '{disk_path}': {e}")
            return {"status": "error", "error": str(e)}

    def drop_table(self, table_name: str) -> bool:
        """Drops a table from DuckDB memory and removes any cached file (.json, .csv, .parquet)."""
        import re
        from pathlib import Path
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", table_name).lower().strip("_")

        try:
            with self._lock:
                cur = self.con.cursor()
                cur.execute(f"DROP TABLE IF EXISTS {safe_name};")
            self.dataset_lineage.pop(safe_name, None)
            ds_dir = Path(__file__).resolve().parent.parent.parent.parent / "local_data" / "derived_datasets"
            if ds_dir.exists():
                for ext in (".json", ".csv", ".parquet", ".meta.json"):
                    cached = ds_dir / f"{safe_name}{ext}"
                    if cached.exists():
                        cached.unlink()
            return True
        except Exception as e:
            logger.error(f"Failed to drop table {safe_name}: {e}")
            return False

duckdb_service = DuckDBService()
