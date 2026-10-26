"""
Canonical canvas contracts, chart archetypes, Tableau-style single filter widgets,
dimension extraction from live widgets/tables, and deterministic ECharts compiler.
"""
from enum import Enum
import time
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class ChartArchetype(str, Enum):
    BAR = "bar"
    STACKED_BAR = "stacked_bar"
    HORIZONTAL_BAR = "horizontal_bar"
    LINE = "line"
    AREA = "area"
    DUAL_AXIS = "dual_axis"
    MULTI_AXIS = "multi_axis"
    PIE_DONUT = "pie_donut"
    HEATMAP = "heatmap"
    CALENDAR = "calendar"
    SCATTER = "scatter"
    RADAR = "radar"
    KPI_METRIC = "kpi_metric"
    TABLE = "table"
    TABLE_ROWSPAN = "table_rowspan"
    PIVOT_TABLE = "pivot_table"
    TEXT_AUDIT = "text_audit"


class FilterPrimitiveType(str, Enum):
    DROPDOWN = "dropdown"
    SELECT = "select"
    MULTI_DROPDOWN = "multi_dropdown"
    CHECKBOX = "checkbox"
    CHECKBOX_GROUP = "checkbox_group"
    RADIO = "radio"
    RANGE = "range"
    NUMERIC_MIN = "numeric_min"
    SLIDER = "slider"
    TOP_N = "top_n"
    SEARCH_TEXT = "search_text"
    DATE_PICKER = "date_picker"
    DATERANGE = "daterange"
    TOGGLE = "toggle"


class FilterOption(BaseModel):
    label: str
    value: Any
    count: Optional[Union[int, float]] = None


class FilterControlContract(BaseModel):
    id: str
    type: FilterPrimitiveType
    label: str
    field: Optional[str] = None
    target_column: Optional[str] = None
    target_widget_ids: List[str] = Field(default_factory=lambda: ["all"])
    options: Optional[List[FilterOption]] = None
    default_value: Optional[Any] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    step: Optional[float] = None


class SingleFilterWidgetSpec(BaseModel):
    filter_type: str  # 'dropdown' | 'checkbox' | 'range' | 'date_picker'
    field: str
    label: str
    target_widget_ids: List[str] = Field(default_factory=lambda: ["all"])
    source_info: Dict[str, Any] = Field(default_factory=dict)
    options: List[Dict[str, Any]] = Field(default_factory=list)
    value: Any = "all"
    selected_values: List[str] = Field(default_factory=list)
    min: float = 0.0
    max: float = 100.0
    step: float = 1.0
    unit: str = ""
    range_value: List[float] = Field(default_factory=lambda: [0.0, 100.0])
    date_start: str = ""
    date_end: str = ""
    preset: str = "all"


class WidgetQuerySpec(BaseModel):
    sql: str
    archetype: ChartArchetype = ChartArchetype.BAR
    x_field: Optional[str] = None
    y_fields: List[str] = Field(default_factory=list)
    category_field: Optional[str] = None
    value_field: Optional[str] = None
    filter_scope: str = "global"


class WidgetVisualSpec(BaseModel):
    archetype: ChartArchetype = ChartArchetype.BAR
    title: str
    subtitle: Optional[str] = ""
    color_palette: Optional[List[str]] = None
    stacked: bool = False
    smooth: bool = True
    area: bool = False
    show_legend: bool = True
    y_axis_name: Optional[str] = None
    y2_axis_name: Optional[str] = None
    unit: Optional[str] = None


CANONICAL_PALETTE = [
    "#6750A4",  # Primary Purple
    "#006A6A",  # Teal Accent
    "#E26D5C",  # Coral Orange
    "#388E3C",  # Emerald Green
    "#D0BCFF",  # Lavender Tint
    "#B3261E",  # Crimson SLA/Alert
    "#2196F3",  # Blue
    "#FF9800",  # Amber
]


def extract_widget_dimensions(widget: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Inspects an ECharts or Table widget and extracts its real filterable dimensions,
    categories, counts, and numeric bounds so single filter widgets can bind directly
    to the chart's actual data (Tableau-style).
    """
    spec = widget.get("spec") or {}
    if not isinstance(spec, dict):
        return []

    w_id = widget.get("id", "")
    w_title = widget.get("title", "Chart")
    dimensions: List[Dict[str, Any]] = []

    # Collect sub-titles if title is a list (e.g. multi-chart ECharts specs)
    subtitles: List[str] = []
    raw_title = spec.get("title")
    if isinstance(raw_title, list):
        for t in raw_title[1:]:
            if isinstance(t, dict) and t.get("text"):
                subtitles.append(str(t["text"]).strip())

    series_list = spec.get("series") if isinstance(spec.get("series"), list) else []

    # 1. Inspect Categorical Axes (xAxis or yAxis)
    for axis_key, axis_dir in (("yAxis", "y"), ("xAxis", "x")):
        raw_axis = spec.get(axis_key)
        axes = raw_axis if isinstance(raw_axis, list) else ([raw_axis] if isinstance(raw_axis, dict) else [])
        for ax in axes:
            if not isinstance(ax, dict):
                continue
            cats = ax.get("data")
            if isinstance(cats, list) and len(cats) > 0:
                # Find corresponding Cartesian series (bar, line, scatter)
                matched_series = None
                for s in series_list:
                    if isinstance(s, dict) and s.get("type") in ("bar", "line", "scatter", None):
                        s_data = s.get("data")
                        if isinstance(s_data, list) and len(s_data) == len(cats):
                            matched_series = s
                            break
                if not matched_series:
                    for s in series_list:
                        if isinstance(s, dict) and s.get("type") in ("bar", "line", "scatter"):
                            matched_series = s
                            break

                s_name = matched_series.get("name", "") if matched_series else ""
                s_data = matched_series.get("data", []) if matched_series else []

                # Try matching a descriptive sub-title (e.g., "Tracked file composition")
                dim_label = s_name or ax.get("name") or f"{w_title} Categories"
                for st in subtitles:
                    if s_name and any(tok in st.lower() for tok in s_name.lower().split() if len(tok) > 2):
                        dim_label = st
                        break
                if not s_name and subtitles:
                    dim_label = subtitles[-1]

                options = []
                numeric_vals: List[float] = []
                for idx, cat in enumerate(cats):
                    cat_str = str(cat.get("value", cat)) if isinstance(cat, dict) else str(cat)
                    val_num = None
                    if idx < len(s_data):
                        dp = s_data[idx]
                        raw_v = dp.get("value") if isinstance(dp, dict) else dp
                        try:
                            val_num = float(raw_v)
                            numeric_vals.append(val_num)
                        except (ValueError, TypeError):
                            pass
                    opt: Dict[str, Any] = {"label": cat_str, "value": cat_str}
                    if val_num is not None:
                        opt["count"] = int(val_num) if val_num.is_integer() else round(val_num, 2)
                    options.append(opt)

                min_v = min(numeric_vals) if numeric_vals else 0.0
                max_v = max(numeric_vals) if numeric_vals else 100.0
                dimensions.append({
                    "dimension": dim_label,
                    "field": s_name or ax.get("name") or axis_key,
                    "label": dim_label,
                    "axis": axis_dir,
                    "series_name": s_name,
                    "widget_id": w_id,
                    "widget_title": w_title,
                    "source_widget_id": w_id,
                    "source_widget_title": w_title,
                    "options": options,
                    "min": min_v,
                    "max": max_v,
                    "recommended_filter_type": "checkbox" if len(options) <= 10 else "dropdown"
                })

    # 2. Inspect Pie / Donut Series
    for idx, s in enumerate(series_list):
        if isinstance(s, dict) and s.get("type") == "pie":
            s_name = s.get("name") or f"Pie Series {idx + 1}"
            s_data = s.get("data") if isinstance(s.get("data"), list) else []
            if not s_data:
                continue
            dim_label = s_name
            for st in subtitles:
                if any(tok in st.lower() for tok in s_name.lower().split() if len(tok) > 2):
                    dim_label = st
                    break
            if dim_label == s_name and subtitles:
                dim_label = subtitles[0]

            options = []
            numeric_vals = []
            for dp in s_data:
                if isinstance(dp, dict) and dp.get("name") is not None:
                    c_name = str(dp["name"])
                    raw_v = dp.get("value")
                    val_num = None
                    try:
                        val_num = float(raw_v) if raw_v is not None else None
                        if val_num is not None:
                            numeric_vals.append(val_num)
                    except (ValueError, TypeError):
                        pass
                    opt = {"label": c_name, "value": c_name}
                    if val_num is not None:
                        opt["count"] = int(val_num) if val_num.is_integer() else round(val_num, 2)
                    options.append(opt)

            if options:
                dimensions.append({
                    "dimension": dim_label,
                    "field": s_name,
                    "label": dim_label,
                    "axis": "pie",
                    "series_name": s_name,
                    "widget_id": w_id,
                    "widget_title": w_title,
                    "source_widget_id": w_id,
                    "source_widget_title": w_title,
                    "options": options,
                    "min": min(numeric_vals) if numeric_vals else 0.0,
                    "max": max(numeric_vals) if numeric_vals else 100.0,
                    "recommended_filter_type": "checkbox" if len(options) <= 10 else "dropdown"
                })

    # 3. Inspect Table / Rowspan Table / Pivot Table columns
    table_rows = spec.get("rows") or (spec.get("table_data", {}).get("rows") if isinstance(spec.get("table_data"), dict) else None)
    table_cols = spec.get("columns") or (spec.get("table_data", {}).get("columns") if isinstance(spec.get("table_data"), dict) else None)
    if isinstance(table_rows, list) and len(table_rows) > 0:
        cols_norm, _, dict_rows = _normalize_rows(table_cols or [], table_rows)
        for col_name in cols_norm[:4]:
            counts_by_val: Dict[str, int] = {}
            num_vals: List[float] = []
            for r in dict_rows:
                v = r.get(col_name)
                if v is None:
                    continue
                try:
                    num_vals.append(float(v))
                except (ValueError, TypeError):
                    s_val = str(v).strip()
                    if s_val:
                        counts_by_val[s_val] = counts_by_val.get(s_val, 0) + 1
            if counts_by_val:
                opts = [{"label": k, "value": k, "count": cnt} for k, cnt in counts_by_val.items()]
                dimensions.append({
                    "dimension": str(col_name),
                    "field": str(col_name),
                    "label": str(col_name),
                    "axis": "table",
                    "column": str(col_name),
                    "widget_id": w_id,
                    "widget_title": w_title,
                    "source_widget_id": w_id,
                    "source_widget_title": w_title,
                    "options": opts,
                    "min": min(num_vals) if num_vals else 0.0,
                    "max": max(num_vals) if num_vals else 100.0,
                    "recommended_filter_type": "checkbox" if len(opts) <= 10 else "dropdown"
                })

    return dimensions


def build_single_filter_widget(
    filter_type: str,
    label: Optional[str] = None,
    field: Optional[str] = None,
    dimension: Optional[str] = None,
    options: Optional[List[Dict[str, Any]]] = None,
    target_widget_ids: Optional[List[str]] = None,
    source_info: Optional[Dict[str, Any]] = None,
    min_val: float = 0.0,
    max_val: float = 1000.0,
    step_val: float = 1.0,
    unit: str = "",
    default_value: Any = "all",
    widget_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Builds a canonical Tableau-style Single Filter Widget supporting 9 filter types:
    dropdown, multi_dropdown, checkbox, radio, range, top_n, search_text, date_picker, toggle.
    """
    raw_dim = dimension or label or field or "Category"
    raw_label = label or dimension or field or "Category"
    clean_label = raw_label.strip()
    if clean_label.lower().startswith("filter:"):
        clean_label = clean_label[7:].strip() or "Category"
    resolved_dim = raw_dim.strip()
    if resolved_dim.lower().startswith("filter:"):
        resolved_dim = resolved_dim[7:].strip() or clean_label
    resolved_label = clean_label
    resolved_field = field or resolved_dim or resolved_label or "category"

    norm_type = filter_type.lower().strip()
    if norm_type in ("select", "dropdown", "single_dropdown"):
        norm_type = "dropdown"
    elif norm_type in ("multi_dropdown", "multidropdown", "multi_select_dropdown", "tags_dropdown"):
        norm_type = "multi_dropdown"
    elif norm_type in ("checkbox", "checkbox_group", "checklist", "multi_select", "multiselect"):
        norm_type = "checkbox"
    elif norm_type in ("radio", "radio_group", "single_choice"):
        norm_type = "radio"
    elif norm_type in ("range", "slider", "numeric_min", "number_range"):
        norm_type = "range"
    elif norm_type in ("top_n", "topn", "bottom_n", "rank", "top"):
        norm_type = "top_n"
    elif norm_type in ("search", "search_text", "text_search", "wildcard", "contains"):
        norm_type = "search_text"
    elif norm_type in ("date", "date_picker", "daterange", "calendar"):
        norm_type = "date_picker"
    elif norm_type in ("toggle", "switch", "boolean", "outlier"):
        norm_type = "toggle"
    else:
        norm_type = "checkbox" if options and len(options) <= 10 else "dropdown"

    clean_options: List[Dict[str, Any]] = []
    for o in (options or []):
        if isinstance(o, dict):
            clean_options.append({
                "label": str(o.get("label", o.get("value", ""))),
                "value": str(o.get("value", o.get("label", ""))),
                **({"count": o["count"]} if "count" in o and o["count"] is not None else {})
            })
        else:
            clean_options.append({"label": str(o), "value": str(o)})

    all_values = [o["value"] for o in clean_options]
    targets = target_widget_ids if target_widget_ids else ["all"]
    src = source_info or {"type": "widget_dimension", "field": resolved_field}

    if norm_type == "range":
        span = max(max_val - min_val, 1.0)
        computed_step = step_val if step_val != 1.0 else (1.0 if span <= 500 else round(span / 100.0))
    else:
        computed_step = step_val

    w_id = widget_id or f"filter-{norm_type}-{int(time.time() * 1000)}"
    type_badge = {
        "dropdown": "Dropdown",
        "multi_dropdown": "Multi-Dropdown",
        "checkbox": "Checkbox",
        "radio": "Radio",
        "range": "Range",
        "top_n": "Top N",
        "search_text": "Search",
        "date_picker": "Date",
        "toggle": "Toggle"
    }.get(norm_type, "Filter")

    title_text = resolved_label
    grid_h = 3 if norm_type in ("checkbox", "radio", "multi_dropdown") else 2

    spec: Dict[str, Any] = {
        "type": "single_filter",
        "filter_type": norm_type,
        "dimension": resolved_dim,
        "field": resolved_field,
        "label": resolved_label,
        "target_widget_ids": targets,
        "source_info": src,
        "options": clean_options,
        "value": "30d" if norm_type == "date_picker" and default_value == "all" else (default_value if norm_type in ("dropdown", "radio", "date_picker") else "all"),
        "selected_values": all_values,
        "min": float(min_val),
        "max": float(max_val if max_val > min_val else min_val + 100.0),
        "step": float(computed_step),
        "unit": unit,
        "range_value": [float(min_val), float(max_val if max_val > min_val else min_val + 100.0)],
        "top_n_count": min(5, max(1, len(clean_options))) if clean_options else 5,
        "top_n_dir": "top",
        "search_query": "",
        "search_mode": "contains",
        "toggle_enabled": False,
        "toggle_mode": "exclude_max",
        "date_presets": ["7d", "30d", "90d", "ytd", "all"],
        "date_start": "",
        "date_end": "",
        "preset": "all"
    }

    return {
        "id": w_id,
        "title": title_text,
        "widget_type": "filter",
        "grid": {"x": 0, "y": 0, "w": 4, "h": grid_h},
        "datasource": {
            "type": "filter_widget",
            "label": f"{type_badge} • {resolved_label}",
            "field": resolved_field
        },
        "spec": spec
    }


def _normalize_rows(columns: List[str], rows: Any) -> tuple[List[str], List[List[Any]], List[Dict[str, Any]]]:
    """Normalizes rows into both matrix format (list of lists) and dict format (list of dicts)."""
    if not columns:
        columns = []
    matrix_rows: List[List[Any]] = []
    dict_rows: List[Dict[str, Any]] = []

    if not rows:
        return columns, matrix_rows, dict_rows

    first_item = rows[0]
    if isinstance(first_item, dict):
        if not columns:
            columns = list(first_item.keys())
        dict_rows = rows
        for r in rows:
            matrix_rows.append([r.get(c) for c in columns])
    elif isinstance(first_item, (list, tuple)):
        if not columns:
            columns = [f"col_{i+1}" for i in range(len(first_item))]
        for r in rows:
            row_list = list(r)
            matrix_rows.append(row_list)
            dict_rows.append({col: row_list[i] if i < len(row_list) else None for i, col in enumerate(columns)})
    else:
        if not columns:
            columns = ["value"]
        for r in rows:
            matrix_rows.append([r])
            dict_rows.append({columns[0]: r})

    return columns, matrix_rows, dict_rows


def compile_widget_spec(
    archetype: Union[ChartArchetype, str],
    title: str,
    subtitle: str = "",
    sql: str = "",
    columns: Optional[List[str]] = None,
    rows: Optional[Any] = None,
    visual_options: Optional[Dict[str, Any]] = None,
    existing_spec: Optional[Dict[str, Any]] = None,
    filter_scope: str = "global"
) -> Dict[str, Any]:
    """
    Compiles an analytical query result into a deterministic, high-contrast Apache ECharts specification.
    Includes raw dataset lineage and visual spec metadata for predictable re-evaluations.
    """
    if isinstance(archetype, ChartArchetype):
        archetype_str = archetype.value
    else:
        archetype_str = str(archetype).lower().strip()

    columns = columns or []
    visual_options = visual_options or {}
    existing_spec = existing_spec or {}

    cols, matrix_rows, dict_rows = _normalize_rows(columns, rows)
    palette = visual_options.get("color_palette") or CANONICAL_PALETTE

    base_title = {
        "text": title,
        "subtext": subtitle,
        "left": "center",
        "textStyle": {"fontSize": 14, "fontWeight": 600, "color": "#1C1B1F"}
    }
    if subtitle:
        base_title["subtextStyle"] = {"fontSize": 11, "color": "#79747E"}

    spec: Dict[str, Any] = {
        "title": base_title,
        "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
        "color": palette,
        "grid": {"left": "4%", "right": "4%", "bottom": "12%", "top": "18%", "containLabel": True},
        "series": []
    }

    if archetype_str in ("pie", "pie_donut", "donut"):
        cat_col = visual_options.get("category_field") or (cols[0] if cols else "category")
        val_col = visual_options.get("value_field") or (cols[1] if len(cols) > 1 else cat_col)

        pie_data = []
        for r in dict_rows:
            raw_val = r.get(val_col)
            try:
                num_val = float(raw_val) if raw_val is not None else 0.0
            except (ValueError, TypeError):
                num_val = 0.0
            pie_data.append({
                "name": str(r.get(cat_col, "Unknown")),
                "value": num_val
            })

        spec["tooltip"] = {"trigger": "item", "formatter": "{b}: {c} ({d}%)"}
        spec["legend"] = {"bottom": "2%", "left": "center"}
        spec["series"] = [{
            "name": title,
            "type": "pie",
            "radius": ["42%", "70%"] if archetype_str in ("pie_donut", "donut") else "65%",
            "avoidLabelOverlap": True,
            "itemStyle": {"borderRadius": 8, "borderColor": "#ffffff", "borderWidth": 2},
            "label": {"show": True, "formatter": "{b}: {d}%"},
            "data": pie_data
        }]

    elif archetype_str in ("calendar", "calendar_heatmap") or (
        archetype_str == "heatmap"
        and (
            len(cols) <= 2
            or any(k in (cols[0] or "").lower() for k in ("date", "day", "time", "commit_date", "committed_at"))
        )
    ):
        date_field = visual_options.get("date_field") or visual_options.get("x_field") or (cols[0] if cols else "date")
        val_field = visual_options.get("value_field") or (visual_options.get("y_fields", [None])[0] if visual_options.get("y_fields") else None) or (cols[1] if len(cols) > 1 else cols[0])

        calendar_points = []
        max_val = 1.0
        min_val = 0.0
        dates_seen: List[str] = []
        for r in dict_rows:
            raw_d = str(r.get(date_field, "")).strip()
            # Extract YYYY-MM-DD cleanly from ISO dates or timestamps
            d_str = raw_d[:10]
            if not d_str or len(d_str) < 10 or d_str[4] != "-":
                continue
            raw_val = r.get(val_field)
            try:
                val = float(raw_val) if raw_val is not None else 0.0
            except (ValueError, TypeError):
                val = 0.0
            calendar_points.append([d_str, val])
            dates_seen.append(d_str)
            if val > max_val:
                max_val = val
            if val < min_val:
                min_val = val

        cal_range: Any = visual_options.get("calendar_range")
        if not cal_range:
            if len(dates_seen) >= 2:
                sorted_d = sorted(dates_seen)
                cal_range = [sorted_d[0], sorted_d[-1]]
            elif len(dates_seen) == 1:
                cal_range = dates_seen[0][:7]
            else:
                cal_range = "2026"

        spec.pop("grid", None)
        spec.pop("xAxis", None)
        spec.pop("yAxis", None)
        spec["tooltip"] = {
            "position": "top",
            "formatter": "{@[0]}: {@[1]} commits"
        }
        spec["visualMap"] = {
            "min": 0,
            "max": max_val if max_val > 0 else 5,
            "calculable": True,
            "orient": "horizontal",
            "left": "center",
            "bottom": "0%",
            "inRange": {"color": ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"]}
        }
        spec["calendar"] = {
            "top": "22%",
            "left": "45px",
            "right": "25px",
            "bottom": "18%",
            "cellSize": ["auto", 15],
            "range": cal_range,
            "itemStyle": {"borderWidth": 2, "borderColor": "rgba(255,255,255,0.08)"},
            "yearLabel": {"show": False},
            "dayLabel": {"firstDay": 1, "nameMap": "en", "margin": 10},
            "monthLabel": {"nameMap": "en", "margin": 10}
        }
        spec["series"] = [{
            "name": title,
            "type": "heatmap",
            "coordinateSystem": "calendar",
            "data": calendar_points
        }]

    elif archetype_str == "heatmap":
        x_field = visual_options.get("x_field") or (cols[0] if cols else "x")
        y_field = visual_options.get("y_field") or (cols[1] if len(cols) > 1 else "y")
        val_field = visual_options.get("value_field") or (cols[2] if len(cols) > 2 else "val")

        x_categories = list(dict.fromkeys(str(r.get(x_field)) for r in dict_rows if r.get(x_field) is not None))
        y_categories = list(dict.fromkeys(str(r.get(y_field)) for r in dict_rows if r.get(y_field) is not None))

        x_index_map = {cat: i for i, cat in enumerate(x_categories)}
        y_index_map = {cat: i for i, cat in enumerate(y_categories)}

        heatmap_points = []
        max_val = 1.0
        min_val = 0.0
        for r in dict_rows:
            x_cat = str(r.get(x_field))
            y_cat = str(r.get(y_field))
            raw_val = r.get(val_field)
            try:
                val = float(raw_val) if raw_val is not None else 0.0
            except (ValueError, TypeError):
                val = 0.0
            if x_cat in x_index_map and y_cat in y_index_map:
                heatmap_points.append([x_index_map[x_cat], y_index_map[y_cat], val])
                if val > max_val:
                    max_val = val
                if val < min_val:
                    min_val = val

        spec["tooltip"] = {"position": "top"}
        spec["xAxis"] = {"type": "category", "data": x_categories, "splitArea": {"show": True}}
        spec["yAxis"] = {"type": "category", "data": y_categories, "splitArea": {"show": True}}
        spec["visualMap"] = {
            "min": min_val,
            "max": max_val if max_val > min_val else 10,
            "calculable": True,
            "orient": "horizontal",
            "left": "center",
            "bottom": "0%",
            "inRange": {"color": ["#EADDFF", "#7F67BE", "#4F378B"]}
        }
        spec["series"] = [{
            "name": title,
            "type": "heatmap",
            "data": heatmap_points,
            "label": {"show": True}
        }]

    elif archetype_str == "radar":
        cat_col = visual_options.get("x_field") or (cols[0] if cols else "dimension")
        y_cols = visual_options.get("y_fields") or (cols[1:] if len(cols) > 1 else [cols[0]])
        indicators = []
        for r in dict_rows:
            d_name = str(r.get(cat_col, "Dim"))
            row_max = 10.0
            for yc in y_cols:
                try:
                    v = float(r.get(yc, 0) or 0)
                    if v * 1.2 > row_max:
                        row_max = round(v * 1.2, 2)
                except Exception:
                    pass
            indicators.append({"name": d_name, "max": row_max})

        radar_data = []
        for yc in y_cols:
            vals = []
            for r in dict_rows:
                try:
                    vals.append(float(r.get(yc, 0) or 0))
                except Exception:
                    vals.append(0.0)
            radar_data.append({"name": str(yc), "value": vals})

        spec.pop("grid", None)
        spec["tooltip"] = {"trigger": "item"}
        spec["legend"] = {"data": [str(c) for c in y_cols], "bottom": "2%", "left": "center"}
        spec["radar"] = {"indicator": indicators or [{"name": "Metric", "max": 100}], "radius": "62%"}
        spec["series"] = [{
            "name": title,
            "type": "radar",
            "data": radar_data,
            "areaStyle": {"opacity": 0.2}
        }]

    elif archetype_str in ("kpi", "kpi_metric"):
        val_col = visual_options.get("value_field") or (cols[0] if cols else "value")
        raw_val = dict_rows[0].get(val_col) if dict_rows else 0
        spec["kpi_data"] = {
            "metric_name": title,
            "metric_value": raw_val,
            "unit": visual_options.get("unit", ""),
            "delta": visual_options.get("delta", None)
        }
        spec["series"] = []

    elif archetype_str in ("table", "table_rowspan", "pivot_table"):
        table_mode = (
            "pivot" if archetype_str == "pivot_table" or visual_options.get("table_mode") == "pivot"
            else "rowspan" if archetype_str == "table_rowspan" or visual_options.get("enable_rowspan") or visual_options.get("table_mode") == "rowspan"
            else "standard"
        )
        rowspan_cols = visual_options.get("rowspan_columns") or visual_options.get("group_fields") or ([cols[0]] if cols else [])
        row_fields = visual_options.get("row_fields") or ([cols[0]] if cols else [])
        col_field = visual_options.get("column_field") or (cols[1] if len(cols) > 1 else (cols[0] if cols else "category"))
        val_field = visual_options.get("value_field") or (cols[-1] if cols else "value")
        agg_fn = str(visual_options.get("agg", "SUM")).upper()

        spec["type"] = "table"
        spec["table_mode"] = table_mode
        spec["enable_rowspan"] = table_mode in ("rowspan", "pivot")
        spec["rowspan_columns"] = rowspan_cols
        spec["columns"] = [{"key": str(c), "label": str(c)} for c in cols]
        spec["rows"] = dict_rows
        spec["group_fields"] = rowspan_cols
        spec["row_fields"] = row_fields
        spec["column_field"] = col_field
        spec["value_field"] = val_field
        spec["agg"] = agg_fn
        spec["pivot_config"] = {
            "row_fields": row_fields,
            "column_field": col_field,
            "value_field": val_field,
            "agg": agg_fn,
            "show_totals": True,
        }
        spec["table_data"] = {
            "columns": cols,
            "rows": matrix_rows,
            "table_mode": table_mode,
        }
        spec["series"] = []

    elif archetype_str in ("dual_axis", "multi_axis"):
        x_col = visual_options.get("x_field") or (cols[0] if cols else "category")
        y_cols = visual_options.get("y_fields") or (cols[1:] if len(cols) > 1 else [cols[0]])
        if len(y_cols) < 2 and len(cols) > 1:
            y_cols = [cols[1], cols[1]]

        x_data = [str(r.get(x_col, "")) for r in dict_rows]
        spec["legend"] = {"data": [str(c) for c in y_cols], "bottom": "2%", "left": "center"}
        spec["xAxis"] = {"type": "category", "data": x_data}

        y_axes = []
        series_list = []
        series_types = visual_options.get("series_types") or []
        for idx, y_col in enumerate(y_cols):
            axis_idx = 0 if idx == 0 else 1
            if idx < 2:
                y_axes.append({
                    "type": "value",
                    "name": (visual_options.get("y_axis_name") if idx == 0 else visual_options.get("y2_axis_name")) or str(y_col),
                    "position": "left" if idx == 0 else "right"
                })
            y_vals = []
            for r in dict_rows:
                try:
                    y_vals.append(float(r.get(y_col, 0)) if r.get(y_col) is not None else 0.0)
                except Exception:
                    y_vals.append(0.0)

            s_type = series_types[idx] if idx < len(series_types) else ("bar" if idx == 0 else "line")
            color = palette[idx % len(palette)]
            s_obj: Dict[str, Any] = {
                "name": str(y_col),
                "type": s_type,
                "yAxisIndex": axis_idx if len(y_cols) > 1 else 0,
                "itemStyle": {"color": color},
                "data": y_vals
            }
            if s_type == "bar":
                s_obj["itemStyle"]["borderRadius"] = [6, 6, 0, 0]
            else:
                s_obj["smooth"] = True
            series_list.append(s_obj)

        spec["yAxis"] = y_axes if len(y_axes) > 1 else (y_axes[0] if y_axes else {"type": "value"})
        spec["series"] = series_list

    else:
        x_col = visual_options.get("x_field") or (cols[0] if cols else "category")
        y_cols = visual_options.get("y_fields") or (cols[1:] if len(cols) > 1 else [cols[0]])
        is_stacked = archetype_str == "stacked_bar" or visual_options.get("stacked", False)
        is_horizontal = archetype_str == "horizontal_bar" or visual_options.get("horizontal", False)
        is_scatter = archetype_str == "scatter"
        is_line_or_area = archetype_str in ("line", "area")
        is_area = archetype_str == "area" or visual_options.get("area", False)
        chart_type = "scatter" if is_scatter else ("line" if is_line_or_area else "bar")

        x_data = [str(r.get(x_col, "")) for r in dict_rows]
        if is_horizontal:
            spec["yAxis"] = {"type": "category", "data": x_data}
            spec["xAxis"] = {"type": "value", "name": visual_options.get("y_axis_name", "")}
        else:
            spec["xAxis"] = {"type": "category", "data": x_data}
            spec["yAxis"] = {"type": "value", "name": visual_options.get("y_axis_name", "")}

        series_list = []
        for i, y_col in enumerate(y_cols):
            s_data = []
            for r in dict_rows:
                raw = r.get(y_col)
                try:
                    s_data.append(float(raw) if raw is not None else 0.0)
                except Exception:
                    s_data.append(0.0)

            color = palette[i % len(palette)]
            s_config: Dict[str, Any] = {
                "name": str(y_col),
                "type": chart_type,
                "data": s_data,
                "itemStyle": {"color": color}
            }
            if chart_type == "bar":
                s_config["itemStyle"]["borderRadius"] = [0, 6, 6, 0] if is_horizontal else [6, 6, 0, 0]
            if is_stacked:
                s_config["stack"] = "total"
            if chart_type == "line":
                s_config["smooth"] = visual_options.get("smooth", True)
                if is_area:
                    s_config["areaStyle"] = {"opacity": 0.25, "color": color}

            series_list.append(s_config)

        if len(y_cols) > 1:
            spec["legend"] = {"data": [str(c) for c in y_cols], "bottom": "2%", "left": "center"}

        spec["series"] = series_list

    spec["sql"] = sql
    spec["archetype"] = archetype_str
    spec["filter_scope"] = filter_scope
    spec["raw_table"] = {"columns": cols, "rows": matrix_rows}
    spec["visual_spec"] = {
        "archetype": archetype_str,
        "title": title,
        "subtitle": subtitle,
        "filter_scope": filter_scope,
        **visual_options
    }

    return spec
