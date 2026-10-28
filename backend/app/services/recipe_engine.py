"""
Declarative Agent Recipe Engine for Dynamic Data Regeneration.
Executes agent-defined dataset generation recipes (Git extractors, DuckDB SQL, Python pipelines)
and validates the output against a schema contract before refreshing live widgets.
"""

import json
import logging
import tempfile
from typing import Any
from pathlib import Path

from backend.app.services.duckdb_service import duckdb_service
from backend.app.services.git_service import git_service

logger = logging.getLogger(__name__)


class RecipeEngine:
    """Executes declarative agent recipes to dynamically regenerate datasets on repository updates or refreshes."""

    def execute_recipe(
        self,
        recipe: dict[str, Any],
        target_table: str | None = None,
    ) -> dict[str, Any]:
        """
        Executes a declarative recipe and returns the resulting records.
        Optionally updates the destination DuckDB table if target_table is given.
        """
        if not recipe or not isinstance(recipe, dict):
            return {"success": False, "error": "Invalid recipe specification"}

        recipe_type = recipe.get("recipe_type") or recipe.get("type") or "sql_derivation"
        instruction = recipe.get("instruction") or recipe.get("description") or "Dynamic dataset derivation"
        table_name = target_table or recipe.get("target_table") or recipe.get("table_name")
        contract_schema = recipe.get("contract_schema") or recipe.get("columns") or []

        try:
            records: list[dict[str, Any]] = []

            # 1. Parameterized Git Extraction
            if recipe_type in ("git_extractor", "git_extraction"):
                records = self._execute_git_extractor(recipe)

            # 2. SQL Derivation across DuckDB tables
            elif recipe_type in ("sql_derivation", "duckdb_sql", "sql"):
                records = self._execute_sql_derivation(recipe)

            # 3. Direct Query execution
            elif recipe_type == "query" or recipe.get("query"):
                sql = recipe.get("query") or recipe.get("sql")
                q_res = duckdb_service.execute_widget_query(sql, filter_scope="global")
                records = q_res.get("data", [])

            else:
                return {
                    "success": False,
                    "error": f"Unsupported recipe type: '{recipe_type}'",
                    "needs_healing": True,
                }

            if not records:
                return {
                    "success": False,
                    "error": "Recipe execution produced 0 records",
                    "needs_healing": False,
                }

            # 4. Schema Contract Validation
            if contract_schema and isinstance(contract_schema, list) and len(contract_schema) > 0:
                first_row = records[0] if records else {}
                missing_cols = [c for c in contract_schema if c not in first_row]
                if missing_cols:
                    logger.warning(
                        f"Schema contract mismatch for recipe '{instruction}': missing columns {missing_cols}"
                    )
                    return {
                        "success": False,
                        "error": f"Schema contract mismatch: missing required columns {missing_cols}",
                        "needs_healing": True,
                        "columns_present": list(first_row.keys()),
                        "columns_required": contract_schema,
                    }

            # 5. Persist / Materialize into DuckDB if target_table specified
            if table_name:
                lineage_meta = {
                    "origin_type": "agent_recipe",
                    "source_name": recipe.get("repo") or "repository",
                    "derivation_summary": instruction,
                    "refresh_recipe": recipe,
                    "contract_schema": contract_schema,
                }
                mat_res = duckdb_service.materialize_dataset(
                    table_name=table_name,
                    records=records,
                    replace=True,
                    lineage=lineage_meta,
                )
                if not mat_res.get("success", False):
                    logger.warning(f"Failed to materialize dataset '{table_name}': {mat_res.get('error')}")

            cols = list(records[0].keys()) if records else []
            return {
                "success": True,
                "table_name": table_name,
                "row_count": len(records),
                "columns": cols,
                "data": records,
                "instruction": instruction,
            }

        except Exception as e:
            logger.error(f"Recipe execution error for '{instruction}': {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "needs_healing": True,
                "instruction": instruction,
            }

    def _execute_git_extractor(self, recipe: dict[str, Any]) -> list[dict[str, Any]]:
        """Extracts records from a git repository and optionally transforms them with SQL."""
        repo_name = recipe.get("repo")
        mode = recipe.get("mode") or recipe.get("extraction_mode") or "git_search"
        path_filter = recipe.get("path_filter") or ""
        search_pattern = recipe.get("search_pattern") or ""
        limit = recipe.get("limit") or 500

        # Resolve repo path dynamically
        from backend.app.database import SessionLocal
        from backend.app.models import LocalRepository

        repo_path = None
        with SessionLocal() as db:
            r_obj = None
            if repo_name:
                r_obj = db.query(LocalRepository).filter(LocalRepository.name == repo_name).first()
            if not r_obj:
                r_obj = db.query(LocalRepository).first()
            if r_obj:
                repo_path = r_obj.local_path
                repo_name = r_obj.name

        if not repo_path or not Path(repo_path).exists():
            if repo_name:
                default_path = Path("local_data/repos") / repo_name
                if default_path.exists():
                    repo_path = str(default_path)
            if not repo_path or not Path(repo_path).exists():
                repos_dir = Path("local_data/repos")
                if repos_dir.exists():
                    for entry in sorted(repos_dir.iterdir()):
                        if entry.is_dir() and not entry.name.startswith("."):
                            repo_path = str(entry)
                            repo_name = entry.name
                            break
                repo_path = str(default_path)

        if not repo_path:
            raise ValueError(f"Repository '{repo_name}' not found locally.")

        res = git_service.extract_custom_repository_records(
            local_path=repo_path,
            mode=mode,
            path_filter=path_filter,
            search_pattern=search_pattern,
            limit=limit,
        )
        raw_records = res.get("records", [])
        if not raw_records:
            return []

        sql_derivation = recipe.get("sql_derivation") or recipe.get("aggregation_sql")
        if not sql_derivation:
            return raw_records

        # Run SQL derivation over raw extracted records in DuckDB with safety validation
        import re
        no_comm = re.sub(r"--[^\n]*", "", sql_derivation)
        no_comm = re.sub(r"/\*.*?\*/", "", no_comm, flags=re.DOTALL).strip()
        first_token = no_comm.split()[0].upper() if no_comm.split() else ""
        if first_token not in ("SELECT", "WITH", "FROM"):
            raise ValueError(f"Recipe derivation query must be a SELECT or WITH statement, got '{first_token}'.")
        for bad in ("ATTACH", "COPY", "INSTALL", "LOAD", "PRAGMA", "EXPORT"):
            if re.search(rf"\b{bad}\b", no_comm, re.IGNORECASE):
                raise ValueError(f"Disallowed keyword '{bad}' in recipe derivation query.")

        import duckdb
        con = duckdb.connect()
        with tempfile.NamedTemporaryFile("w", suffix=".json") as f:
            json.dump(raw_records, f)
            f.flush()
            # Replace placeholder 'staging_commits' or 'staging_records' with read_json_auto
            escaped_f = f.name.replace("'", "''")
            query = sql_derivation
            for placeholder in ("staging_records", "staging_commits", "extracted_records", "git_records"):
                query = query.replace(placeholder, f"read_json_auto('{escaped_f}')")

            # Fallback if no placeholder was used: table alias
            if f"read_json_auto('{escaped_f}')" not in query:
                con.execute(f"CREATE TABLE staging_records AS SELECT * FROM read_json_auto('{escaped_f}');")

            cursor = con.execute(query)
            col_names = [d[0] for d in con.description]
            rows = cursor.fetchall()

        transformed = []
        for r in rows:
            row_dict = {}
            for idx, col in enumerate(col_names):
                val = r[idx]
                # Convert decimal/numeric to float/int for clean JSON serialization
                if hasattr(val, "as_tuple"):
                    val = float(val)
                row_dict[col] = val
            transformed.append(row_dict)

        return transformed

    def _execute_sql_derivation(self, recipe: dict[str, Any]) -> list[dict[str, Any]]:
        """Executes a pure DuckDB SQL derivation query."""
        sql = recipe.get("sql") or recipe.get("query")
        if not sql:
            raise ValueError("SQL derivation recipe missing 'sql' property.")

        q_res = duckdb_service.execute_widget_query(sql, filter_scope="global")
        if q_res.get("error"):
            raise ValueError(f"DuckDB SQL error: {q_res.get('error')}")
        return q_res.get("data", [])


recipe_engine = RecipeEngine()
