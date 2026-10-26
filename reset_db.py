"""
Database Reset & Slate Management Utility
Usage:
    python reset_db.py --clean   # Wipes mock dashboards/widgets, leaves a clean empty workspace
    python reset_db.py --mock    # Restores default demo dashboards & mock widgets
    python reset_db.py --hard    # Completely drops and rebuilds all tables from scratch via Alembic
"""
import sys
import uuid
from backend.app.database import engine, Base, SessionLocal, ensure_db_schema
from backend.app.models import User, Dashboard, DashboardWidget, DashboardComment, MCPConfig, LocalRepository, AgentPersona, ChatMessage, ChatSession
from backend.app.services.seed_data import seed_database, sync_real_disk_repositories
from backend.app.config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD

def clean_slate():
    """Removes all mock dashboards, widgets, comments, and demo MCP tools, keeping real disk repos."""
    ensure_db_schema()
    db = SessionLocal()
    try:
        # 1. Delete all widgets and comments
        db.query(DashboardComment).delete()
        db.query(DashboardWidget).delete()
        
        # 2. Delete all dashboards
        db.query(Dashboard).delete()

        # 3. Delete demo colleague user if exists
        colleague = db.query(User).filter(User.email == "sarah.lead@antigravity.io").first()
        if colleague:
            db.delete(colleague)

        # 4. Delete demo MCP tools and accumulated test chat sessions
        db.query(MCPConfig).delete()
        db.query(ChatMessage).delete()
        db.query(ChatSession).delete()
        db.commit()

        # 5. Seed admin and agent personas
        seed_database(db, force_mock=False)

        # 6. Discover & register real disk repositories (superset, hog.git, agor)
        sync_real_disk_repositories(db, remove_fake_if_clean=True)

        admin = db.query(User).filter(User.email == DEFAULT_ADMIN_EMAIL).first()
        # 7. Create clean default dashboard
        clean_dash = Dashboard(
            id=str(uuid.uuid4()),
            user_id=admin.id,
            title="My Workspace",
            description="Clean production dashboard canvas. Chat with the Antigravity agent or click '+ Add Visual' to create widgets.",
            is_default=True,
            is_public=False
        )
        db.add(clean_dash)
        db.commit()
        print("✓ Successfully wiped mock dashboards, widgets, and tools.")
        print(f"✓ Created clean 'My Workspace' dashboard for {admin.email}.")
        print("✓ Re-synced real cloned repositories and default personas.")
    finally:
        db.close()

def restore_mock():
    """Seeds the full demo showcase."""
    import os
    ensure_db_schema()
    os.environ["SEED_MOCK_DATA"] = "true"
    db = SessionLocal()
    try:
        seed_database(db)
        print("✓ Demo showcase dashboards and mock tools successfully seeded.")
    finally:
        db.close()

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "--clean"
    if mode == "--clean":
        clean_slate()
    elif mode == "--mock":
        restore_mock()
    else:
        print(f"Unknown option: {mode}. Use --clean or --mock.")
