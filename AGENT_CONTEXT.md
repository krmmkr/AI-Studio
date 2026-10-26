# Agent Context & Dynamic Engineering Intelligence Guidelines

This file provides domain context for the Antigravity Studio agents (Google Antigravity SDK and OpenCode SDK).

## 1. Dynamic, Requirement-Driven Repository & Codebase Analysis

Antigravity Studio does **not** restrict analysis to fixed committer/contributor tables. There are **no** pre-baked `github_commits` or `github_contributors` tables unless explicitly created. Instead, you dynamically inspect the repository and propose custom datasets tailored to the exact question asked by the user.

### Dynamic Extraction Modes (`extract_repository_dataset_records`)
When the user asks to analyze a repository or create datasets/charts:
1. **Features, Routes, Components & Authorship (`extraction_mode="features_and_modules"`)**:
   - Extracts real features, API endpoints/routes, UI components, classes, and functions from the codebase along with **who authored them** (`primary_author`, `last_author`, `contributor_count`, `commits_on_file`, `file_loc`, `module`, `last_modified`).
2. **Codebase Issues, Tech Debt (TODO/FIXME/BUG) & Bugfix History (`extraction_mode="issues_todos_and_fixes"`)**:
   - Extracts in-code issue markers (`TODO`, `FIXME`, `BUG`, `HACK`, `DEPRECATED`) and issue/bugfix commits along with their author, date, module, file/line reference, and churn.
3. **File & Module Ownership / Hotspots (`extraction_mode="file_ownership_and_churn"`)**:
   - Extracts per-file and per-module ownership, primary author, contributor count, commit count, lines added/deleted, and total churn.
4. **Custom Git History & Diff Search (`extraction_mode="git_search"`)**:
   - Searches commit messages (`--grep`) or code diffs (`-S`) and path filters to build custom tables for specific features, keywords, or subsystems.

### Creating Custom Datasets (`propose_duckdb_dataset`)
- Always propose custom datasets that match the user's specific requirement:
  - Pass `propose_table_name` directly to `extract_repository_dataset_records`, **OR**
  - Call `propose_duckdb_dataset(table_name="...", description="...", records=[...])` with any custom list of dictionary records synthesized from your codebase/git tools (`read_repository_file`, `search_repository_code`, `analyze_code_complexity`, `extract_repository_dataset_records`).
- Once proposed, you can immediately reference `table_name` in `upsert_chart_widget(sql_query="SELECT ... FROM <table_name>")` OR pass `data_records=[...]` directly to `upsert_chart_widget`.

## 2. Canvas Visualizations & Cross-Filtering

- Use `upsert_chart_widget` to mount interactive Apache ECharts (`bar`, `horizontal_bar`, `stacked_bar`, `line`, `area`, `pie`, `donut`, `scatter`, `radar`, `heatmap`, `calendar`, `treemap`, `kpi`, `table`) on the active dashboard canvas.
- Use `create_single_filter_widget` to mount interactive cross-filters for any dimension present in your datasets or canvas charts (e.g., `primary_author`, `category`, `module`, `tag`, `issue_kind`).
- Palette:
  - Primary series: `#6750A4` (Indigo/Purple)
  - Secondary series: `#0D9488` (Teal), `#2563EB` (Blue), `#10B981` (Emerald)
  - Alert / Warning series: `#E11D48` (Rose), `#F59E0B` (Amber)
