import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
LOCAL_DATA_DIR = BASE_DIR / "local_data"
STORAGE_DIR = LOCAL_DATA_DIR / "storage"
STATIC_DIR = BASE_DIR / "backend" / "app" / "static"

# Ensure local directories exist
LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# Database URL: Supports PostgreSQL (e.g. postgresql://user:pass@localhost:5432/cockpit) or local SQLite
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{LOCAL_DATA_DIR / 'cockpit.db'}"
)

# JWT Secret - stable persistent secret across restarts
JWT_SECRET = os.environ.get("JWT_SECRET", "antigravity-studio-session-secret-key-stable-2026")

JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_MINUTES = 60 * 24  # 24 hours

# Default Seed Credentials (can be overridden via ENV)
DEFAULT_ADMIN_EMAIL = os.environ.get("DEFAULT_ADMIN_EMAIL", "admin@antigravity.io")
DEFAULT_ADMIN_PASSWORD = os.environ.get("DEFAULT_ADMIN_PASSWORD", "antigravity123")

# Host & Port
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
