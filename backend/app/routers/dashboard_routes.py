import json
import uuid
import datetime
import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.app.auth import get_current_user
from backend.app.database import get_db
from backend.app.models import User, Dashboard, DashboardWidget, DashboardComment, ChatSession, ChatMessage
from backend.app.services.duckdb_service import duckdb_service
from backend.app.schemas.canvas_contracts import compile_widget_spec, ChartArchetype

logger = logging.getLogger("dashboard_routes")

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

class WidgetPayload(BaseModel):
    widget_id: str
    title: str
    widget_type: str = "echarts"
    grid: dict
    spec: dict
    datasource: dict | None = None
    datasources: list[dict] | None = None

class DashboardCreatePayload(BaseModel):
    title: str
    description: str | None = None
    sources: list[dict] | None = None
    datasources: list[dict] | None = None

class LayoutUpdatePayload(BaseModel):
    # Mapping of widget_id -> { x, y, w, h, pixel_height?, zone_id? }
    layouts: dict[str, dict[str, Any]]

class DashboardZonesPayload(BaseModel):
    zones: list[dict[str, Any]]

class SharePayload(BaseModel):
    is_public: bool

class DashboardSourcesPayload(BaseModel):
    sources: list[dict] | None = None
    datasources: list[dict] | None = None

class DashboardEvaluatePayload(BaseModel):
    filters: dict = {}
    widget_ids: list[str] | None = None

@router.get("")
def list_dashboards(scope: str = "all", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Dashboard)
    if scope == "my":
        query = query.filter(Dashboard.user_id == current_user.id, Dashboard.is_public == False)
    elif scope == "public":
        query = query.filter(Dashboard.is_public == True)
    else:
        query = query.filter((Dashboard.user_id == current_user.id) | (Dashboard.is_public == True))

    dashboards = query.order_by(Dashboard.created_at.desc()).all()
    results = []
    for d in dashboards:
        owner = db.query(User).filter(User.id == d.user_id).first()
        results.append({
            "id": d.id,
            "title": d.title,
            "description": d.description,
            "is_default": d.is_default,
            "is_public": bool(d.is_public),
            "is_owner": (d.user_id == current_user.id),
            "owner_email": owner.email if owner else "Team Member",
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "widget_count": len(d.widgets),
            "datasources": json.loads(d.datasources_json) if d.datasources_json else []
        })
    return results

@router.get("/{dashboard_id}")
def get_dashboard(dashboard_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dashboard = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True)
    ).first()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widgets_data = []
    for w in dashboard.widgets:
        raw_ds = json.loads(w.datasource_json) if w.datasource_json else None
        sources = []
        if isinstance(raw_ds, dict):
            if "sources" in raw_ds and isinstance(raw_ds["sources"], list):
                sources = raw_ds["sources"]
            elif raw_ds:
                sources = [raw_ds]

        widgets_data.append({
            "id": w.widget_id,
            "title": w.title,
            "widget_type": w.widget_type,
            "grid": json.loads(w.grid_json) if w.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
            "spec": json.loads(w.spec_json) if w.spec_json else {},
            "datasource": raw_ds,
            "datasources": sources,
            "updated_at": w.updated_at.isoformat() if w.updated_at else None
        })

    # Deterministic spatial sort: order widgets by grid y (row), grid x (col), and id
    widgets_data.sort(key=lambda item: (
        item.get("grid", {}).get("y", 0) if isinstance(item.get("grid"), dict) else 0,
        item.get("grid", {}).get("x", 0) if isinstance(item.get("grid"), dict) else 0,
        str(item.get("id", ""))
    ))

    owner = db.query(User).filter(User.id == dashboard.user_id).first()
    return {
        "id": dashboard.id,
        "title": dashboard.title,
        "description": dashboard.description,
        "is_default": dashboard.is_default,
        "is_public": bool(dashboard.is_public),
        "is_owner": (dashboard.user_id == current_user.id),
        "owner_email": owner.email if owner else "Team Member",
        "widgets": widgets_data,
        "datasources": json.loads(dashboard.datasources_json) if dashboard.datasources_json else [],
        "zones": json.loads(dashboard.zones_json) if getattr(dashboard, "zones_json", None) else []
    }

@router.put("/{dashboard_id}/zones")
def update_dashboard_zones(dashboard_id: str, payload: DashboardZonesPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if dash.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only owner can modify dashboard zones")
    dash.zones_json = json.dumps(payload.zones)
    db.commit()
    return {"id": dash.id, "zones": payload.zones}

@router.put("/{dashboard_id}/share")
def toggle_share_dashboard(dashboard_id: str, payload: SharePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if dash.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only owner can modify sharing settings")
    dash.is_public = payload.is_public
    db.commit()
    return {"id": dash.id, "is_public": dash.is_public}

@router.put("/{dashboard_id}/sources")
def update_dashboard_sources(dashboard_id: str, payload: DashboardSourcesPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if dash.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only owner can modify dashboard sources")
    srcs = payload.sources if payload.sources is not None else (payload.datasources or [])
    dash.datasources_json = json.dumps(srcs)
    db.commit()
    return {"id": dash.id, "datasources": srcs}

@router.post("")
def create_dashboard(payload: DashboardCreatePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash_id = str(uuid.uuid4())
    srcs = payload.sources if payload.sources is not None else (payload.datasources or [])
    dash = Dashboard(
        id=dash_id,
        user_id=current_user.id,
        title=payload.title,
        description=payload.description,
        is_default=False,
        datasources_json=json.dumps(srcs) if srcs else None
    )
    db.add(dash)
    db.commit()
    return {"id": dash.id, "title": dash.title}

@router.post("/{dashboard_id}/duplicate")
def duplicate_dashboard(dashboard_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    source_dash = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not source_dash:
        raise HTTPException(status_code=404, detail="Source dashboard not found")

    new_dash_id = str(uuid.uuid4())
    new_dash = Dashboard(
        id=new_dash_id,
        user_id=current_user.id,
        title=f"{source_dash.title} (Copy)",
        description=source_dash.description,
        is_default=False,
        is_public=False,
        datasources_json=source_dash.datasources_json
    )
    db.add(new_dash)
    db.flush()

    # Clone widgets
    source_widgets = db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == dashboard_id).all()
    for w in source_widgets:
        cloned_w = DashboardWidget(
            dashboard_id=new_dash_id,
            widget_id=str(uuid.uuid4())[:8],
            title=w.title,
            widget_type=w.widget_type,
            grid_json=w.grid_json,
            spec_json=w.spec_json,
            datasource_json=w.datasource_json
        )
        db.add(cloned_w)

    db.commit()
    return {"id": new_dash.id, "title": new_dash.title, "widget_count": len(source_widgets)}

@router.delete("/{dashboard_id}")
def delete_dashboard(dashboard_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dashboard = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    if dashboard.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to delete this dashboard")

    # Detach any chat sessions scoped to this dashboard
    db.query(ChatSession).filter(ChatSession.dashboard_id == dashboard_id).update(
        {ChatSession.dashboard_id: None}, synchronize_session=False
    )

    # Delete associated widgets and comments
    db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == dashboard_id).delete(synchronize_session=False)
    db.query(DashboardComment).filter(DashboardComment.dashboard_id == dashboard_id).delete(synchronize_session=False)

    db.delete(dashboard)
    db.commit()
    return {"success": True, "id": dashboard_id, "message": "Dashboard deleted successfully"}

@router.post("/{dashboard_id}/widgets")
def upsert_widget(dashboard_id: str, payload: WidgetPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dashboard = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        Dashboard.user_id == current_user.id
    ).first()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    existing_widget = db.query(DashboardWidget).filter(
        DashboardWidget.dashboard_id == dashboard_id,
        DashboardWidget.widget_id == payload.widget_id
    ).first()

    ds_data = None
    if payload.datasources is not None:
        ds_data = {"sources": payload.datasources}
    elif payload.datasource is not None:
        ds_data = payload.datasource

    if existing_widget:
        existing_widget.title = payload.title
        existing_widget.widget_type = payload.widget_type
        existing_widget.grid_json = json.dumps(payload.grid)
        existing_widget.spec_json = json.dumps(payload.spec)
        existing_widget.datasource_json = json.dumps(ds_data) if ds_data else None
    else:
        new_widget = DashboardWidget(
            dashboard_id=dashboard_id,
            widget_id=payload.widget_id,
            title=payload.title,
            widget_type=payload.widget_type,
            grid_json=json.dumps(payload.grid),
            spec_json=json.dumps(payload.spec),
            datasource_json=json.dumps(ds_data) if ds_data else None
        )
        db.add(new_widget)

    db.commit()
    return {"success": True, "widget_id": payload.widget_id}

@router.put("/{dashboard_id}/layout")
def update_dashboard_layout(dashboard_id: str, payload: LayoutUpdatePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dashboard = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        Dashboard.user_id == current_user.id
    ).first()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widgets = db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == dashboard_id).all()
    for w in widgets:
        if w.widget_id in payload.layouts:
            w.grid_json = json.dumps(payload.layouts[w.widget_id])
    db.commit()
    return {"success": True, "message": "Layout saved"}

@router.post("/{dashboard_id}/widgets/{widget_id}/refresh")
def refresh_widget(dashboard_id: str, widget_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True) | (current_user.role == "admin")
    ).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or access denied")

    widget = db.query(DashboardWidget).filter(
        DashboardWidget.dashboard_id == dashboard_id,
        DashboardWidget.widget_id == widget_id
    ).first()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")

    datasource = json.loads(widget.datasource_json) if widget.datasource_json else {}
    spec = json.loads(widget.spec_json) if widget.spec_json else {}

    # Handle react_app widgets safely: update underlying dataset without destroying component code
    if widget.widget_type == "react_app" or spec.get("type") == "react_app":
        query_to_run = datasource.get("query") or datasource.get("sql")
        
        # 1. Check if an agent recipe is attached to this widget or its dataset
        recipe = datasource.get("refresh_recipe") or spec.get("refresh_recipe")
        if not recipe and query_to_run:
            m = re.search(r"FROM\s+([a-zA-Z0-9_]+)", query_to_run, re.IGNORECASE)
            if m:
                source_tbl = m.group(1).lower()
                recipe = duckdb_service.get_dataset_recipe(source_tbl)

        if recipe:
            from backend.app.services.recipe_engine import recipe_engine
            rec_res = recipe_engine.execute_recipe(recipe)
            if rec_res.get("success") and rec_res.get("data"):
                if query_to_run:
                    q_res = duckdb_service.execute_widget_query(query_to_run, filter_scope=spec.get("filter_scope", "global"))
                    if q_res.get("data"):
                        spec["data"] = q_res.get("data", [])
                        spec["rows"] = q_res.get("data", [])
                        spec["columns"] = q_res.get("columns", [])
                    else:
                        spec["data"] = rec_res["data"]
                        spec["rows"] = rec_res["data"]
                        spec["columns"] = rec_res.get("columns", [])
                else:
                    spec["data"] = rec_res["data"]
                    spec["rows"] = rec_res["data"]
                    spec["columns"] = rec_res.get("columns", [])
        elif query_to_run:
            try:
                filter_scope = spec.get("filter_scope", "global")
                q_res = duckdb_service.execute_widget_query(query_to_run, filter_scope=filter_scope)
                data_rows = q_res.get("data", [])
                cols = q_res.get("columns", [])
                spec["data"] = data_rows
                spec["rows"] = data_rows
                spec["columns"] = cols
                datasource["query"] = query_to_run
            except Exception as e:
                logger.warning(f"Error querying DuckDB for react_app widget '{widget_id}': {e}")
        widget.updated_at = datetime.datetime.utcnow()
        widget.spec_json = json.dumps(spec)
        widget.datasource_json = json.dumps(datasource) if datasource else None
        db.commit()
        return {
            "success": True,
            "id": widget.widget_id,
            "title": widget.title,
            "widget_type": widget.widget_type,
            "grid": json.loads(widget.grid_json) if widget.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
            "spec": spec,
            "datasource": datasource,
            "updated_at": widget.updated_at.isoformat()
        }

    # Handle filter widgets safely
    if widget.widget_type in ("filter", "filter_controller") or spec.get("type") in ("filter", "single_filter"):
        widget.updated_at = datetime.datetime.utcnow()
        db.commit()
        return {
            "success": True,
            "id": widget.widget_id,
            "title": widget.title,
            "widget_type": widget.widget_type,
            "grid": json.loads(widget.grid_json) if widget.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
            "spec": spec,
            "datasource": datasource,
            "updated_at": widget.updated_at.isoformat()
        }

    # Execute real analytics query against DuckDB dataset for standard charts if defined
    query_to_run = datasource.get("query") or datasource.get("sql") or spec.get("sql") or spec.get("query")

    if query_to_run:
        try:
            filter_scope = spec.get("filter_scope", "global")
            q_res = duckdb_service.execute_widget_query(query_to_run, filter_scope=filter_scope)
            data_rows = q_res.get("data", [])
            cols = q_res.get("columns", [])
            if data_rows and cols:
                archetype = spec.get("archetype") or spec.get("visual_spec", {}).get("archetype")
                if not archetype:
                    series = spec.get("series", [])
                    if series and isinstance(series, list) and len(series) > 0:
                        s_type = series[0].get("type", "")
                        if s_type in ("pie", "donut"):
                            archetype = "pie_donut"
                        elif s_type == "heatmap":
                            archetype = "heatmap"
                        elif s_type in ("bar", "line"):
                            archetype = s_type
                    if "table_data" in spec:
                        archetype = "table"
                    elif "kpi_data" in spec:
                        archetype = "kpi_metric"
                    if not archetype:
                        archetype = "bar"

                title = spec.get("title", {}).get("text", widget.title) if isinstance(spec.get("title"), dict) else widget.title
                subtitle = spec.get("title", {}).get("subtext", "") if isinstance(spec.get("title"), dict) else ""
                spec = compile_widget_spec(
                    archetype=archetype,
                    title=title,
                    subtitle=subtitle,
                    sql=query_to_run,
                    columns=cols,
                    rows=data_rows,
                    visual_options=spec.get("visual_spec", {}),
                    existing_spec=spec,
                    filter_scope=filter_scope
                )
                datasource["query"] = query_to_run
        except Exception as e:
            logger.warning(f"Live DuckDB query refresh error for widget '{widget_id}': {e}")

    if spec.get("type") == "text_audit":
        spec["status"] = "🟢 Real-time Telemetry Synced with DuckDB"
        spec["last_sync"] = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    widget.updated_at = datetime.datetime.utcnow()
    widget.spec_json = json.dumps(spec)
    db.commit()

    return {
        "id": widget.widget_id,
        "title": widget.title,
        "widget_type": widget.widget_type,
        "grid": json.loads(widget.grid_json) if widget.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
        "spec": spec,
        "datasource": datasource,
        "updated_at": widget.updated_at.isoformat()
    }

@router.post("/{dashboard_id}/refresh")
def refresh_dashboard(
    dashboard_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    dash = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True) | (current_user.role == "admin")
    ).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or access denied")

    # 1. Sync bound local repositories or all registered repositories
    from backend.app.models import LocalRepository
    from backend.app.services.git_service import git_service

    synced_repos = []
    bound_sources = json.loads(dash.datasources_json) if dash.datasources_json else []
    target_repo_ids = [s.get("id") for s in bound_sources if s.get("type") in ("git", "repo")]

    repo_query = db.query(LocalRepository)
    if target_repo_ids:
        repo_query = repo_query.filter(LocalRepository.id.in_(target_repo_ids))
    repos_to_sync = repo_query.all()

    for r in repos_to_sync:
        try:
            sync_res = git_service.sync_repository(r.local_path, r.default_branch, r.remote_url)
            r.last_synced_at = datetime.datetime.utcnow()
            synced_repos.append({
                "id": r.id,
                "name": r.name,
                "head_sha": sync_res.get("head_sha", ""),
                "commit_count": sync_res.get("commit_count", 0),
                "ingested_commits": sync_res.get("ingested_commits", 0)
            })
        except Exception as e:
            logger.warning(f"Error syncing repo '{r.name}': {e}")
    db.commit()

    # 2. Refresh each widget on this dashboard
    widgets = db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == dashboard_id).all()
    refreshed_widgets = []

    for widget in widgets:
        datasource = json.loads(widget.datasource_json) if widget.datasource_json else {}
        spec = json.loads(widget.spec_json) if widget.spec_json else {}
        query_to_run = datasource.get("query") or datasource.get("sql")

        # Safely preserve react_app widgets: refresh their data rows without destroying custom component code
        if widget.widget_type == "react_app" or spec.get("type") == "react_app":
            # Check for declarative generation recipe
            recipe = datasource.get("refresh_recipe") or spec.get("refresh_recipe")
            if not recipe and query_to_run:
                m = re.search(r"FROM\s+([a-zA-Z0-9_]+)", query_to_run, re.IGNORECASE)
                if m:
                    source_tbl = m.group(1).lower()
                    recipe = duckdb_service.get_dataset_recipe(source_tbl)

            if recipe:
                from backend.app.services.recipe_engine import recipe_engine
                rec_res = recipe_engine.execute_recipe(recipe)
                if rec_res.get("success") and rec_res.get("data"):
                    if query_to_run:
                        q_res = duckdb_service.execute_widget_query(query_to_run, filter_scope=spec.get("filter_scope", "global"))
                        if q_res.get("data"):
                            spec["data"] = q_res.get("data", [])
                            spec["rows"] = q_res.get("data", [])
                            spec["columns"] = q_res.get("columns", [])
                        else:
                            spec["data"] = rec_res["data"]
                            spec["rows"] = rec_res["data"]
                            spec["columns"] = rec_res.get("columns", [])
                    else:
                        spec["data"] = rec_res["data"]
                        spec["rows"] = rec_res["data"]
                        spec["columns"] = rec_res.get("columns", [])
            elif query_to_run:
                try:
                    filter_scope = spec.get("filter_scope", "global")
                    q_res = duckdb_service.execute_widget_query(query_to_run, filter_scope=filter_scope)
                    data_rows = q_res.get("data", [])
                    cols = q_res.get("columns", [])
                    spec["data"] = data_rows
                    spec["rows"] = data_rows
                    spec["columns"] = cols
                    datasource["query"] = query_to_run
                except Exception as e:
                    logger.warning(f"Error querying DuckDB for react_app widget '{widget.widget_id}': {e}")
            widget.updated_at = datetime.datetime.utcnow()
            widget.spec_json = json.dumps(spec)
            widget.datasource_json = json.dumps(datasource) if datasource else None
            refreshed_widgets.append({
                "id": widget.widget_id,
                "title": widget.title,
                "widget_type": widget.widget_type,
                "grid": json.loads(widget.grid_json) if widget.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
                "spec": spec,
                "datasource": datasource,
                "updated_at": widget.updated_at.isoformat()
            })
            continue

        # Safely preserve filter controllers
        if widget.widget_type in ("filter", "filter_controller") or spec.get("type") in ("filter", "single_filter"):
            refreshed_widgets.append({
                "id": widget.widget_id,
                "title": widget.title,
                "widget_type": widget.widget_type,
                "grid": json.loads(widget.grid_json) if widget.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
                "spec": spec,
                "datasource": datasource,
                "updated_at": widget.updated_at.isoformat() if widget.updated_at else datetime.datetime.utcnow().isoformat()
            })
            continue

        query_to_run = datasource.get("query") or datasource.get("sql") or spec.get("sql") or spec.get("query")

        if query_to_run:
            try:
                filter_scope = spec.get("filter_scope", "global")
                q_res = duckdb_service.execute_widget_query(query_to_run, filter_scope=filter_scope)
                data_rows = q_res.get("data", [])
                cols = q_res.get("columns", [])
                if data_rows and cols:
                    archetype = spec.get("archetype") or spec.get("visual_spec", {}).get("archetype")
                    if not archetype:
                        series = spec.get("series", [])
                        if series and isinstance(series, list) and len(series) > 0:
                            s_type = series[0].get("type", "")
                            if s_type in ("pie", "donut"):
                                archetype = "pie_donut"
                            elif s_type == "heatmap":
                                archetype = "heatmap"
                            elif s_type in ("bar", "line"):
                                archetype = s_type
                        if "table_data" in spec:
                            archetype = "table"
                        elif "kpi_data" in spec:
                            archetype = "kpi_metric"
                        if not archetype:
                            archetype = "bar"

                    title = spec.get("title", {}).get("text", widget.title) if isinstance(spec.get("title"), dict) else widget.title
                    subtitle = spec.get("title", {}).get("subtext", "") if isinstance(spec.get("title"), dict) else ""
                    spec = compile_widget_spec(
                        archetype=archetype,
                        title=title,
                        subtitle=subtitle,
                        sql=query_to_run,
                        columns=cols,
                        rows=data_rows,
                        visual_options=spec.get("visual_spec", {}),
                        existing_spec=spec,
                        filter_scope=filter_scope
                    )
                    datasource["query"] = query_to_run
            except Exception as e:
                logger.warning(f"Error querying DuckDB for widget '{widget.widget_id}': {e}")

        if spec.get("type") == "text_audit":
            spec["status"] = "🟢 Real-time Telemetry Synced with DuckDB"
            spec["last_sync"] = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

        widget.updated_at = datetime.datetime.utcnow()
        widget.spec_json = json.dumps(spec)
        refreshed_widgets.append({
            "id": widget.widget_id,
            "title": widget.title,
            "widget_type": widget.widget_type,
            "grid": json.loads(widget.grid_json) if widget.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
            "spec": spec,
            "datasource": datasource,
            "updated_at": widget.updated_at.isoformat()
        })
    db.commit()

    return {
        "success": True,
        "message": f"Dashboard refreshed: {len(synced_repos)} repositories synced and {len(refreshed_widgets)} widgets updated.",
        "synced_repos": synced_repos,
        "refreshed_widgets_count": len(refreshed_widgets),
        "widgets": refreshed_widgets
    }

@router.post("/{dashboard_id}/evaluate")
def evaluate_dashboard(
    dashboard_id: str,
    payload: DashboardEvaluatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    dash = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True) | (current_user.role == "admin")
    ).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or access denied")

    widgets_query = db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == dashboard_id)
    if payload.widget_ids:
        widgets_query = widgets_query.filter(DashboardWidget.widget_id.in_(payload.widget_ids))
    widgets = widgets_query.all()

    evaluated_widgets = []
    for widget in widgets:
        datasource = json.loads(widget.datasource_json) if widget.datasource_json else {}
        spec = json.loads(widget.spec_json) if widget.spec_json else {}

        if widget.widget_type in ("filter_controller", "react_app", "filter") or spec.get("type") in ("filter_controller", "react_app", "single_filter"):
            evaluated_widgets.append({
                "id": widget.widget_id,
                "title": widget.title,
                "widget_type": widget.widget_type,
                "grid": json.loads(widget.grid_json) if widget.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
                "spec": spec,
                "datasource": datasource,
                "updated_at": widget.updated_at.isoformat() if widget.updated_at else datetime.datetime.utcnow().isoformat()
            })
            continue

        query_to_run = datasource.get("query") or datasource.get("sql") or spec.get("sql") or spec.get("query_spec", {}).get("sql")
        new_spec = spec
        if query_to_run:
            try:
                filter_scope = spec.get("filter_scope", "global")
                # Scope filters specifically if target_widget_ids are bound to specific charts
                widget_filters = dict(payload.filters)
                for fw in widgets:
                    if fw.widget_type == "filter" or (fw.spec_json and "single_filter" in fw.spec_json):
                        fw_spec = json.loads(fw.spec_json) if fw.spec_json else {}
                        targets = fw_spec.get("target_widget_ids", ["all"])
                        if targets and "all" not in targets and widget.widget_id not in targets:
                            raw_k = str(fw_spec.get("dimension") or fw_spec.get("label") or fw.title).lower()
                            for k in list(widget_filters.keys()):
                                if k.lower() in raw_k or raw_k in k.lower():
                                    widget_filters.pop(k, None)
                            if "author" in raw_k or "committer" in raw_k:
                                widget_filters.pop("author", None)
                                widget_filters.pop("committer", None)
                            elif "repo" in raw_k:
                                widget_filters.pop("repo", None)
                            elif "branch" in raw_k:
                                widget_filters.pop("branch", None)
                            elif "type" in raw_k or "commit_type" in raw_k:
                                widget_filters.pop("commit_type", None)

                q_res = duckdb_service.execute_widget_query(query_to_run, filters=widget_filters, filter_scope=filter_scope)
                data_rows = q_res.get("data", [])
                cols = q_res.get("columns", [])

                archetype = spec.get("archetype") or spec.get("visual_spec", {}).get("archetype")
                if not archetype:
                    series = spec.get("series", [])
                    if series and isinstance(series, list) and len(series) > 0:
                        s_type = series[0].get("type", "")
                        if s_type in ("pie", "donut"):
                            archetype = "pie_donut"
                        elif s_type == "heatmap":
                            archetype = "heatmap"
                        elif s_type in ("bar", "line"):
                            archetype = s_type
                    if "table_data" in spec:
                        archetype = "table"
                    elif "kpi_data" in spec:
                        archetype = "kpi_metric"
                    if not archetype:
                        archetype = "bar"

                active_filters = {k: v for k, v in widget_filters.items() if v and str(v).lower() not in ("all", "all repositories", "none")}
                subtext = f"Scope: {', '.join(f'{k}={v}' for k, v in active_filters.items())}" if active_filters and filter_scope != "none" else (spec.get("title", {}).get("subtext", "") if isinstance(spec.get("title"), dict) else "")

                new_spec = compile_widget_spec(
                    archetype=archetype,
                    title=spec.get("title", {}).get("text", widget.title) if isinstance(spec.get("title"), dict) else widget.title,
                    subtitle=subtext,
                    sql=query_to_run,
                    columns=cols,
                    rows=data_rows,
                    visual_options=spec.get("visual_spec", {}),
                    existing_spec=spec,
                    filter_scope=filter_scope
                )
                datasource["query"] = query_to_run
            except Exception as e:
                logger.warning(f"Error evaluating query for widget '{widget.widget_id}': {e}")

        evaluated_widgets.append({
            "id": widget.widget_id,
            "title": widget.title,
            "widget_type": widget.widget_type,
            "grid": json.loads(widget.grid_json) if widget.grid_json else {"x": 0, "y": 0, "w": 6, "h": 4},
            "spec": new_spec,
            "datasource": datasource,
            "updated_at": widget.updated_at.isoformat() if widget.updated_at else datetime.datetime.utcnow().isoformat()
        })

    return {
        "success": True,
        "filters": payload.filters,
        "widgets": evaluated_widgets,
        "evaluated_count": len(evaluated_widgets)
    }

@router.delete("/{dashboard_id}/widgets/{widget_id}")
def delete_widget(dashboard_id: str, widget_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if dash.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to delete widgets on this dashboard")

    widget = db.query(DashboardWidget).filter(
        DashboardWidget.dashboard_id == dashboard_id,
        DashboardWidget.widget_id == widget_id
    ).first()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")

    db.delete(widget)
    db.commit()
    return {"success": True, "message": "Widget removed"}

# --- Spatial Comments Endpoints ---

class CommentCreatePayload(BaseModel):
    widget_id: str | None = None
    content: str
    pos_x: int = 50
    pos_y: int = 50

class CommentReplyPayload(BaseModel):
    content: str

@router.get("/{dashboard_id}/comments")
def list_comments(dashboard_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True) | (current_user.role == "admin")
    ).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or access denied")

    comments = db.query(DashboardComment).filter(
        DashboardComment.dashboard_id == dashboard_id
    ).order_by(DashboardComment.created_at.asc()).all()
    return [
        {
            "id": c.id,
            "dashboard_id": c.dashboard_id,
            "widget_id": c.widget_id,
            "user_email": c.user_email,
            "content": c.content,
            "replies": json.loads(c.replies_json) if getattr(c, "replies_json", None) else [],
            "pos_x": c.pos_x,
            "pos_y": c.pos_y,
            "is_resolved": c.is_resolved,
            "chat_session_id": c.chat_session_id or f"pin-{c.dashboard_id}-{c.id}",
            "created_at": c.created_at.isoformat() if c.created_at else None
        }
        for c in comments
    ]

@router.post("/{dashboard_id}/comments")
def create_comment(dashboard_id: str, payload: CommentCreatePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True) | (current_user.role == "admin")
    ).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or access denied")

    comment = DashboardComment(
        dashboard_id=dashboard_id,
        widget_id=payload.widget_id,
        user_email=current_user.email,
        content=payload.content,
        replies_json="[]",
        pos_x=payload.pos_x,
        pos_y=payload.pos_y,
        is_resolved=False
    )
    db.add(comment)
    db.flush()

    # Automatically provision a dedicated localized ChatSession for this spatial pin
    session_id = f"pin-{dashboard_id}-{comment.id}"
    comment.chat_session_id = session_id
    existing_session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not existing_session:
        chat_session = ChatSession(
            id=session_id,
            user_id=current_user.id,
            title=f"Pin #{comment.id}: {comment.content[:24]}",
            dashboard_id=dashboard_id,
            scope="pin",
            pin_id=comment.id,
            widget_id=comment.widget_id
        )
        db.add(chat_session)

    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id,
        "dashboard_id": comment.dashboard_id,
        "widget_id": comment.widget_id,
        "user_email": comment.user_email,
        "content": comment.content,
        "replies": [],
        "pos_x": comment.pos_x,
        "pos_y": comment.pos_y,
        "is_resolved": comment.is_resolved,
        "chat_session_id": comment.chat_session_id,
        "created_at": comment.created_at.isoformat()
    }

@router.post("/{dashboard_id}/comments/{comment_id}/replies")
def add_comment_reply(dashboard_id: str, comment_id: int, payload: CommentReplyPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True) | (current_user.role == "admin")
    ).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or access denied")

    comment = db.query(DashboardComment).filter(
        DashboardComment.dashboard_id == dashboard_id,
        DashboardComment.id == comment_id
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment pin not found")

    replies = []
    if getattr(comment, "replies_json", None):
        try:
            replies = json.loads(comment.replies_json)
        except Exception:
            replies = []

    new_reply = {
        "id": f"rep-{int(datetime.datetime.utcnow().timestamp() * 1000)}",
        "user_email": current_user.email,
        "content": payload.content.strip(),
        "created_at": datetime.datetime.utcnow().isoformat()
    }
    replies.append(new_reply)
    comment.replies_json = json.dumps(replies)
    comment.is_resolved = False
    db.commit()

    return {
        "id": comment.id,
        "replies": replies,
        "is_resolved": comment.is_resolved
    }

@router.put("/{dashboard_id}/comments/{comment_id}/resolve")
def toggle_resolve_comment(dashboard_id: str, comment_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True) | (current_user.role == "admin")
    ).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or access denied")

    comment = db.query(DashboardComment).filter(
        DashboardComment.dashboard_id == dashboard_id,
        DashboardComment.id == comment_id
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    comment.is_resolved = not comment.is_resolved
    db.commit()
    return {"id": comment.id, "is_resolved": comment.is_resolved}

@router.get("/{dashboard_id}/comments/{comment_id}/messages")
def list_comment_messages(dashboard_id: str, comment_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(
        Dashboard.id == dashboard_id,
        (Dashboard.user_id == current_user.id) | (Dashboard.is_public == True) | (current_user.role == "admin")
    ).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found or access denied")

    comment = db.query(DashboardComment).filter(
        DashboardComment.dashboard_id == dashboard_id,
        DashboardComment.id == comment_id
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment pin not found")

    session_id = comment.chat_session_id or f"pin-{dashboard_id}-{comment_id}"
    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.created_at.asc()).all()

    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "thoughts": m.thoughts,
            "tool_calls": json.loads(m.tool_calls_json) if m.tool_calls_json else None,
            "created_at": m.created_at.isoformat() if m.created_at else None
        }
        for m in messages
    ]

@router.delete("/{dashboard_id}/comments/{comment_id}")
def delete_comment(dashboard_id: str, comment_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dash = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    comment = db.query(DashboardComment).filter(
        DashboardComment.dashboard_id == dashboard_id,
        DashboardComment.id == comment_id
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Only comment author, dashboard owner, or admin can delete
    if comment.user_email != current_user.email and dash.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to delete this comment")

    # Clean up associated pin chat session if present
    target_session_id = comment.chat_session_id or f"pin-{dashboard_id}-{comment_id}"
    pin_session = db.query(ChatSession).filter(
        (ChatSession.id == target_session_id) | (ChatSession.pin_id == comment_id)
    ).first()
    if pin_session:
        db.delete(pin_session)

    db.delete(comment)
    db.commit()
    return {"success": True, "message": "Comment removed"}
