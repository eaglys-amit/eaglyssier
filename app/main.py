"""FastAPI application factory."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import update

from app import scheduler
from app.api import api_router
from app.config import settings
from app.db import SessionLocal
from app.models import EvaluationSheet, SyncRun, SyncStatus
from app.storage import rustfs
from app.web.routes import provider_ws, report_artifacts, terminal

logging.basicConfig(level=logging.INFO)


def _reconcile_orphaned_syncs() -> None:
    """Any run still `running` at startup was orphaned by a restart/crash.

    The process just started, so nothing is actually syncing; flip those rows to
    `failed` so the UI doesn't spin on a stale "Syncing…" forever and new syncs
    aren't blocked by the running-row guard. Self-heals on every (re)start.
    """
    db = SessionLocal()
    try:
        result = db.execute(
            update(SyncRun)
            .where(SyncRun.status == SyncStatus.running)
            .values(
                status=SyncStatus.failed,
                finished_at=datetime.now(timezone.utc),
                error="Interrupted by server restart.",
            )
        )
        db.commit()
        if result.rowcount:
            logging.getLogger("startup").info(
                "Marked %d orphaned running sync(s) as failed.", result.rowcount
            )
    except Exception:  # noqa: BLE001 - reconciliation is best-effort; don't block startup
        logging.getLogger("startup").warning("Could not reconcile orphaned syncs.")
    finally:
        db.close()

    # Separate transaction so a failure here can't roll back the sync cleanup.
    db = SessionLocal()
    try:
        orphaned_sheets = db.execute(
            update(EvaluationSheet)
            .where(EvaluationSheet.job_status == "running")
            .values(job_status="failed", job_error="Interrupted by server restart.")
        )
        db.commit()
        if orphaned_sheets.rowcount:
            logging.getLogger("startup").info(
                "Marked %d orphaned evaluation job(s) as failed.", orphaned_sheets.rowcount
            )
    except Exception:  # noqa: BLE001
        logging.getLogger("startup").warning("Could not reconcile orphaned evaluation jobs.")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _reconcile_orphaned_syncs()
    try:
        rustfs.ensure_bucket()
    except Exception:  # noqa: BLE001 - storage may not be ready yet; created lazily on use
        logging.getLogger("startup").warning("Could not ensure S3 bucket at startup.")
    if settings.run_scheduler:
        scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="Eaglyssier", lifespan=lifespan)

app.include_router(api_router)
app.include_router(report_artifacts.router)
app.include_router(provider_ws.router)
app.include_router(terminal.router)


@app.get("/health")
def health():
    return {"status": "ok"}


# ------------------------------------------------------------------ React SPA
# The Vite build lands in frontend/dist. Specific routes above (API, report
# artifacts, health, WebSockets) always win: Starlette matches HTTP routes in
# registration order and WS routes are a different scope type entirely.
_SPA_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if (_SPA_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(_SPA_DIST / "assets")), name="spa-assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(404)  # unknown API path -> JSON 404, never index.html
    candidate = _SPA_DIST / full_path
    if full_path and candidate.is_file():
        return FileResponse(str(candidate))  # favicon.ico, robots.txt, ...
    index_file = _SPA_DIST / "index.html"
    if not index_file.is_file():
        return JSONResponse(
            {"detail": "SPA not built. Run `npm run build` in frontend/ (dev: Vite on :5173)."},
            status_code=503,
        )
    return FileResponse(str(index_file))
