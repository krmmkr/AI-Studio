import logging
from sqlalchemy import create_engine, text, event
from sqlalchemy.orm import declarative_base, sessionmaker
from backend.app.config import DATABASE_URL

logger = logging.getLogger("cockpit_database")

engine_kwargs = {}
connect_args = {}

if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False
    connect_args["timeout"] = 15  # Wait up to 15s for locks before failing
    engine_kwargs["connect_args"] = connect_args
else:
    # Production PostgreSQL connection pooling settings
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 20
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 1800

engine = create_engine(DATABASE_URL, **engine_kwargs)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        """Enables SQLite Write-Ahead Logging (WAL) and concurrent reader/writer isolation."""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode = WAL;")
        cursor.execute("PRAGMA synchronous = NORMAL;")
        cursor.execute("PRAGMA busy_timeout = 10000;")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def check_db_connection() -> bool:
    """Verifies that the database is reachable and accepting queries."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return False

def ensure_db_schema():
    """Ensures additive schema migrations on startup without requiring external migration tooling."""
    try:
        with engine.connect() as conn:
            try:
                conn.execute(text("ALTER TABLE dashboards ADD COLUMN datasources_json TEXT;"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE dashboard_comments ADD COLUMN replies_json TEXT;"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_messages_session_created ON chat_messages(session_id, created_at);"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_dashboards_user_public ON dashboards(user_id, is_public);"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_dashboard_widgets_dash_widget ON dashboard_widgets(dashboard_id, widget_id);"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN scope VARCHAR(20) DEFAULT 'dashboard';"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN pin_id INTEGER;"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN widget_id VARCHAR(100);"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE dashboard_comments ADD COLUMN chat_session_id VARCHAR(64);"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN status VARCHAR(30) DEFAULT 'idle';"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN last_error TEXT;"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_messages ADD COLUMN proposals_json TEXT;"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN agent_id VARCHAR(50) DEFAULT 'general';"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN parent_session_id VARCHAR(64);"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN fork_message_id INTEGER;"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE dashboards ADD COLUMN zones_json TEXT;"))
                conn.commit()
            except Exception:
                pass
    except Exception as e:
        logger.debug(f"Schema check notice: {e}")
