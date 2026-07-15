#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Running database migrations..."
alembic upgrade head

echo "[entrypoint] Starting API server..."
# UVICORN_RELOAD=true (dev, via docker-compose) hot-reloads on code changes.
# Left off by default so a built image doesn't run the reloader in production.
RELOAD_FLAG=""
if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
  # Watch only the backend package; frontend/ has its own dev server (Vite)
  # and node_modules churn would otherwise trigger reload storms.
  RELOAD_FLAG="--reload --reload-dir app"
fi
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 ${RELOAD_FLAG}
