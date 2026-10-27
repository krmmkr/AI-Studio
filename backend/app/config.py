import os
import logging
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger("cockpit_config")

BASE_DIR = Path(__file__).resolve().parent.parent.parent
LOCAL_DATA_DIR = BASE_DIR / "local_data"
STORAGE_DIR = LOCAL_DATA_DIR / "storage"
REPOS_DIR = LOCAL_DATA_DIR / "repos"
DERIVED_DATASETS_DIR = LOCAL_DATA_DIR / "derived_datasets"
SESSIONS_ROOT_DIR = LOCAL_DATA_DIR / "agent_sessions"
ANTIGRAVITY_APP_DATA = LOCAL_DATA_DIR / "antigravity_app_data"
STATIC_DIR = BASE_DIR / "backend" / "app" / "static"

# Load .env file from project root if present
ENV_PATH = BASE_DIR / ".env"
if ENV_PATH.exists():
    load_dotenv(dotenv_path=ENV_PATH)

# Ensure local directories exist with open permissions
for _dir in (LOCAL_DATA_DIR, STORAGE_DIR, REPOS_DIR, DERIVED_DATASETS_DIR, SESSIONS_ROOT_DIR, ANTIGRAVITY_APP_DATA, STATIC_DIR):
    _dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(_dir, 0o777)
    except Exception:
        pass

# Environment: 'development', 'testing', 'production'
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").lower()

# Configure sandbox and writable tmp paths for tools and OpenCode
tmp_dir = os.environ.get("TMPDIR", "/tmp")
os.environ.setdefault("OPENCODE_CONFIG_DIR", f"{tmp_dir}/.opencode")
os.environ.setdefault("XDG_CONFIG_HOME", f"{tmp_dir}/.config")
os.environ.setdefault("XDG_DATA_HOME", f"{tmp_dir}/.local/share")
os.environ.setdefault("XDG_CACHE_HOME", f"{tmp_dir}/.cache")
os.environ.setdefault("XDG_STATE_HOME", f"{tmp_dir}/.local/state")
venv_bin = str(BASE_DIR / ".venv" / "bin")
if venv_bin not in os.environ.get("PATH", ""):
    os.environ["PATH"] = f"{venv_bin}:{os.environ.get('PATH', '')}"


def find_opencode_binary() -> str | None:
    """Finds opencode binary dynamically across virtualenv, PATH, and base directories."""
    import shutil
    import sys
    venv_candidate = Path(sys.prefix) / "bin" / "opencode"
    if venv_candidate.is_file() and os.access(venv_candidate, os.X_OK):
        return str(venv_candidate)
    local_candidate = BASE_DIR / ".venv" / "bin" / "opencode"
    if local_candidate.is_file() and os.access(local_candidate, os.X_OK):
        return str(local_candidate)
    found = shutil.which("opencode")
    if found:
        return found
    return None


def normalize_database_url(url: str, base_dir: Path) -> str:
    """
    Normalizes database URLs, with special handling for SQLite to prevent path resolution
    and permission issues in both local development and Docker containers.
    - Normalizes SQLite relative/absolute paths across Docker (/app) and local development.
    - Converts 3-slash URLs pointing to 'app/...' to absolute 4-slash '/app/...' paths.
    - Automatically creates the parent directory of any SQLite file before connection.
    """
    if not url or not url.startswith("sqlite:"):
        return url
    try:
        from sqlalchemy.engine.url import make_url
        parsed = make_url(url)
        db_file = parsed.database
        if not db_file or db_file == ":memory:":
            return url
        file_path = Path(db_file)
        # Handle Docker container paths where WORKDIR is /app
        if str(db_file).startswith("app/"):
            if Path("/app").exists() or str(base_dir) == "/app":
                resolved = Path("/") / db_file
            else:
                resolved = (base_dir / str(db_file)[4:]).resolve()
        elif not file_path.is_absolute():
            resolved = (base_dir / file_path).resolve()
        else:
            resolved = file_path.resolve()
        try:
            resolved.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.chmod(resolved.parent, 0o777)
            except Exception:
                pass
        except Exception:
            pass
        return f"sqlite:///{resolved}"
    except Exception as e:
        logger.warning(f"Could not normalize database URL '{url}': {e}")
        return url


# Database URL
DATABASE_URL = normalize_database_url(
    os.environ.get(
        "DATABASE_URL",
        f"sqlite:///{LOCAL_DATA_DIR / 'cockpit.db'}"
    ),
    BASE_DIR
)

# JWT Secret & Auth Settings
DEFAULT_DEV_SECRET = "antigravity-studio-session-secret-key-stable-2026"
JWT_SECRET = os.environ.get("JWT_SECRET", DEFAULT_DEV_SECRET)
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_MINUTES = int(os.environ.get("JWT_EXPIRATION_MINUTES", "1440"))

# Production security assertion
if ENVIRONMENT == "production" and JWT_SECRET == DEFAULT_DEV_SECRET:
    raise ValueError(
        "CRITICAL SECURITY CONFIGURATION ERROR: "
        "Default development JWT_SECRET is active in a PRODUCTION environment! "
        "Set a strong, cryptographically generated JWT_SECRET in your .env or environment variables."
    )

# Seed Admin Credentials (can be overridden via ENV)
DEFAULT_ADMIN_EMAIL = os.environ.get("DEFAULT_ADMIN_EMAIL", "admin@antigravity.io")
DEFAULT_ADMIN_PASSWORD = os.environ.get("DEFAULT_ADMIN_PASSWORD", "antigravity123")

# Host & Port
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))

# Mock Data Seeding (Set to 'false' in production or for clean slate)
SEED_MOCK_DATA = os.environ.get(
    "SEED_MOCK_DATA",
    "true" if ENVIRONMENT != "production" else "false"
).lower() in ("true", "1", "yes")

# CORS Configuration
raw_origins = os.environ.get("CORS_ORIGINS", "")
if raw_origins.strip():
    CORS_ALLOWED_ORIGINS = [orig.strip() for orig in raw_origins.split(",") if orig.strip()]
else:
    if ENVIRONMENT == "production":
        CORS_ALLOWED_ORIGINS = [f"http://{HOST}:{PORT}"]
    else:
        CORS_ALLOWED_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:5173"]

# LLM Orchestration
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "mock").lower()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
ANTIGRAVITY_MODEL = os.environ.get("ANTIGRAVITY_MODEL", "gemini-3.5-flash")
ANTIGRAVITY_BASE_URL = os.environ.get("ANTIGRAVITY_BASE_URL", "").strip()
ANTIGRAVITY_API_KEY = os.environ.get("ANTIGRAVITY_API_KEY", "").strip()
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENCODE_MODEL = os.environ.get("OPENCODE_MODEL", "openai/gpt-4o")

# Safeguard against unauthorized testing providers in production
if ENVIRONMENT == "production" and LLM_PROVIDER == "opencode":
    raise ValueError(
        "PRODUCTION COMPLIANCE ERROR: OpenCode 2.1 is designated for development/testing only "
        "and is strictly prohibited in production mode. Set LLM_PROVIDER=antigravity for production."
    )
