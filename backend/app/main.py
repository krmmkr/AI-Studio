from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.app.config import (
    STATIC_DIR,
    CORS_ALLOWED_ORIGINS,
    ENVIRONMENT,
    LOCAL_DATA_DIR,
    STORAGE_DIR,
    REPOS_DIR,
    DERIVED_DATASETS_DIR,
    SESSIONS_ROOT_DIR,
    ANTIGRAVITY_APP_DATA,
)
from backend.app.database import engine, Base, SessionLocal, check_db_connection, ensure_db_schema
from backend.app.services.seed_data import seed_database
from backend.app.routers import (
    auth_routes,
    user_routes,
    mcp_routes,
    chat_routes,
    dashboard_routes,
    file_routes,
    duckdb_routes,
    agent_routes
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure local directory structure exists
    for _d in (LOCAL_DATA_DIR, STORAGE_DIR, REPOS_DIR, DERIVED_DATASETS_DIR, SESSIONS_ROOT_DIR, ANTIGRAVITY_APP_DATA, STATIC_DIR):
        _d.mkdir(parents=True, exist_ok=True)

    # Startup: ensure tables and seed database
    Base.metadata.create_all(bind=engine)
    ensure_db_schema()
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    yield
    # Graceful shutdown: cleanup any active OpenCode daemon and child execution processes
    try:
        from backend.app.services.agents.opencode_runner import _OPENCODE_SERVER
        await _OPENCODE_SERVER.close()
    except Exception:
        pass

app = FastAPI(
    title="AI Studio API",
    description="Agentic Chat & Dynamic Dashboard Studio powered by AI Studio & Model Context Protocol",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware configured for production origin isolation
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth_routes.router)
app.include_router(user_routes.router, prefix="/api/user", tags=["user"])
app.include_router(mcp_routes.router)
app.include_router(chat_routes.router)
app.include_router(dashboard_routes.router)
app.include_router(file_routes.router)
app.include_router(duckdb_routes.router)
app.include_router(agent_routes.router)

@app.get("/api/health")
@app.get("/healthz")
async def health_check():
    """Liveness probe: verifies the web service process is active."""
    return {"status": "ok", "service": "AI Studio", "environment": ENVIRONMENT}

@app.get("/readyz")
async def readiness_check():
    """Readiness probe: verifies backend service and database connectivity."""
    db_ok = check_db_connection()
    if not db_ok:
        from fastapi import Response, status
        return Response(
            content='{"status": "unhealthy", "database": "disconnected"}',
            media_type="application/json",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE
        )
    return {"status": "ready", "database": "connected", "environment": ENVIRONMENT}

# Serve compiled frontend if present
index_file = STATIC_DIR / "index.html"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets"), check_dir=False), name="assets")

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    # If API route wasn't matched, check if it's an API route that 404ed
    if full_path.startswith("api/"):
        return {"error": "Not Found", "path": full_path}
    
    # Otherwise fallback to React SPA index.html
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "status": "AI Studio Backend Active",
        "docs": "/docs",
        "note": "React frontend is building or being served in dev mode."
    }
