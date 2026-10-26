#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

WORKERS="${WORKERS:-${WEB_CONCURRENCY:-1}}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

echo "=========================================================="
echo " Starting Antigravity Cockpit (FastAPI + React SPA)"
echo " Server binding: http://${HOST}:${PORT}"
echo " Default Login : admin@antigravity.io / antigravity123"
echo " Workers       : ${WORKERS}"
echo "=========================================================="

if [ "$WORKERS" -gt 1 ]; then
    exec "$DIR/.venv/bin/uvicorn" backend.app.main:app --host "$HOST" --port "$PORT" --workers "$WORKERS"
else
    exec "$DIR/.venv/bin/uvicorn" backend.app.main:app --host "$HOST" --port "$PORT" --reload
fi
