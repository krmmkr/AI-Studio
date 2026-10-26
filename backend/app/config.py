import os
import logging
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger("cockpit_config")

BASE_DIR = Path(__file__).resolve().parent.parent.parent
LOCAL_DATA_DIR = BASE_DIR / "local_data"
STORAGE_DIR = LOCAL_DATA_DIR / "storage"
REPOS_DIR = LOCAL_DATA_DIR / "repos"
STATIC_DIR = BASE_DIR / "backend" / "app" / "static"

# Load .env file from project root if present
ENV_PATH = BASE_DIR / ".env"
if ENV_PATH.exists():
    load_dotenv(dotenv_path=ENV_PATH)

# Ensure local directories exist
LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
REPOS_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

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


# Database URL
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{LOCAL_DATA_DIR / 'cockpit.db'}"
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
