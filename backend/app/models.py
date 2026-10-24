import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey
)
from sqlalchemy.orm import relationship
from backend.app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), default="member")  # admin, member
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    mcp_configs = relationship("MCPConfig", back_populates="user", cascade="all, delete-orphan")
    chat_sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")
    dashboards = relationship("Dashboard", back_populates="user", cascade="all, delete-orphan")
    files = relationship("DatasetFile", back_populates="user", cascade="all, delete-orphan")


class MCPConfig(Base):
    __tablename__ = "mcp_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    scope = Column(String(20), default="user")  # 'global' or 'user'
    transport = Column(String(20), default="sse")  # 'sse' or 'http'
    url = Column(String(500), nullable=False)
    auth_header = Column(String(500), nullable=True)  # encrypted or masked API key / token
    is_active = Column(Boolean, default=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # Null if scope == 'global'
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="mcp_configs")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String(64), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(255), default="New Chat")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    user = relationship("User", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)  # 'user', 'assistant', 'system'
    content = Column(Text, nullable=False)
    thoughts = Column(Text, nullable=True)  # Antigravity thinking tokens
    tool_calls_json = Column(Text, nullable=True)  # Intercepted tool call details
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    session = relationship("ChatSession", back_populates="messages")


class Dashboard(Base):
    __tablename__ = "dashboards"

    id = Column(String(64), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_default = Column(Boolean, default=False)
    is_public = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    user = relationship("User", back_populates="dashboards")
    widgets = relationship("DashboardWidget", back_populates="dashboard", cascade="all, delete-orphan")
    comments = relationship("DashboardComment", back_populates="dashboard", cascade="all, delete-orphan")


class DashboardWidget(Base):
    __tablename__ = "dashboard_widgets"

    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(String(64), ForeignKey("dashboards.id"), nullable=False)
    widget_id = Column(String(100), nullable=False)  # Slug or client-side identifier
    title = Column(String(255), nullable=False)
    widget_type = Column(String(50), default="echarts")  # echarts, metric_card, table
    grid_json = Column(Text, nullable=False)  # JSON: { x: 0, y: 0, w: 6, h: 4 }
    spec_json = Column(Text, nullable=False)  # JSON: ECharts or Vega-Lite option
    datasource_json = Column(Text, nullable=True)  # JSON: MCP source, cached file link
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    dashboard = relationship("Dashboard", back_populates="widgets")


class DashboardComment(Base):
    __tablename__ = "dashboard_comments"

    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(String(64), ForeignKey("dashboards.id"), nullable=False)
    widget_id = Column(String(100), nullable=True)  # Target widget slug, or null for canvas-level
    user_email = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    pos_x = Column(Integer, default=50)  # Percentage X relative to widget (0 - 100)
    pos_y = Column(Integer, default=50)  # Percentage Y relative to widget (0 - 100)
    is_resolved = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    dashboard = relationship("Dashboard", back_populates="comments")


class DatasetFile(Base):
    __tablename__ = "dataset_files"

    id = Column(String(64), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    relative_path = Column(String(500), nullable=False)
    file_size = Column(Integer, default=0)
    mime_type = Column(String(100), default="text/csv")
    description = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="files")


class AgentPersona(Base):
    __tablename__ = "agent_personas"

    id = Column(String(50), primary_key=True)  # 'github-agent', 'superset-agent'
    name = Column(String(100), nullable=False)
    role_description = Column(String(255), nullable=False)
    icon = Column(String(50), default="bot")
    system_instructions = Column(Text, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class LocalRepository(Base):
    __tablename__ = "local_repositories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    remote_url = Column(String(500), nullable=False)
    local_path = Column(String(500), nullable=False)
    clone_type = Column(String(20), default="full")  # 'full', 'shallow'
    default_branch = Column(String(100), default="main")
    last_synced_at = Column(DateTime, default=datetime.datetime.utcnow)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
