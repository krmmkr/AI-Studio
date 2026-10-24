from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.app.config import STATIC_DIR
from backend.app.database import engine, Base, SessionLocal
from backend.app.services.seed_data import seed_database
from backend.app.routers import (
    auth_routes,
    mcp_routes,
    chat_routes,
    dashboard_routes,
    file_routes,
    duckdb_routes,
    agent_routes
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure tables and seed database
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    yield
    # Shutdown logic (if any)

app = FastAPI(
    title="Antigravity Cockpit API",
    description="Agentic Chat & Dynamic Dashboard Studio powered by Google Antigravity & Model Context Protocol",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware (allows local dev and credentials)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth_routes.router)
app.include_router(mcp_routes.router)
app.include_router(chat_routes.router)
app.include_router(dashboard_routes.router)
app.include_router(file_routes.router)
app.include_router(duckdb_routes.router)
app.include_router(agent_routes.router)

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "Antigravity Cockpit"}

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
        "status": "Antigravity Cockpit Backend Active",
        "docs": "/docs",
        "note": "React frontend is building or being served in dev mode."
    }
