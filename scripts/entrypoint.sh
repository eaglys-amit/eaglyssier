#!/usr/bin/env bash
set -euo pipefail

# `docker compose restart` (unlike `up`) ignores depends_on health conditions and
# restarts every service in parallel, so we can land here while Postgres is still
# replaying WAL ("FATAL: the database system is starting up") and crash the
# container. Wait for the server to accept connections before migrating.
# pg_isready wants a libpq URL; DATABASE_URL carries SQLAlchemy's +psycopg driver
# suffix, which libpq doesn't understand.
if [ -n "${DATABASE_URL:-}" ]; then
  PG_URL="${DATABASE_URL/+psycopg/}"
  echo "[entrypoint] Waiting for the database..."
  for _ in $(seq 60); do
    pg_isready -q -d "$PG_URL" && break
    sleep 1
  done
  # One last non-quiet probe so a genuinely unreachable DB fails loudly here
  # rather than as a stack trace out of alembic.
  pg_isready -d "$PG_URL"
fi

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
