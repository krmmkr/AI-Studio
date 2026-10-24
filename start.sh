#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo " Starting Antigravity Cockpit (FastAPI + React SPA)"
echo " Server binding: http://127.0.0.1:8000"
echo " Default Login : admin@antigravity.io / antigravity123"
echo "=========================================================="

exec "$DIR/.venv/bin/uvicorn" backend.app.main:app --host 127.0.0.1 --port 8000 --reload
