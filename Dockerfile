# ==============================================================================
# Multi-Stage Production Dockerfile for Antigravity Cockpit
# ==============================================================================

# Stage 1: Build React 18 Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Production Python Runtime
FROM python:3.12-slim AS runtime
WORKDIR /app

# Install essential system dependencies for Postgres client, Git, & health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend application, migrations, and agent knowledge base
COPY backend/ ./backend/
COPY alembic.ini ./alembic.ini
COPY AGENT_CONTEXT.md ./AGENT_CONTEXT.md
COPY ARCHITECTURE.md ./ARCHITECTURE.md

# Copy compiled frontend assets from frontend-builder
COPY --from=frontend-builder /app/backend/app/static ./backend/app/static

# Ensure persistent storage directories exist
RUN mkdir -p /app/local_data/storage

# Environment defaults
ENV ENVIRONMENT=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Container liveness health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/healthz || exit 1

# Run Uvicorn server
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
