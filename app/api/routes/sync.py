"""Trigger syncs and report their live status (polled by the SPA)."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_or_404, run_in_session
from app.db import get_db
from app.models import GitRepo, Integration, Project, SyncRun, SyncStatus
from app.schemas.integration import SyncRunListItem, SyncRunOut, SyncStatusOut
from app.schemas.jobs import RepoSyncOut
from app.services.sync import sync_integration, sync_repo

router = APIRouter()


def _latest_run(db: Session, integration_id: int) -> SyncRun | None:
    return db.execute(
        select(SyncRun)
        .where(SyncRun.integration_id == integration_id)
        .order_by(desc(SyncRun.started_at))
        .limit(1)
    ).scalars().first()


def _status(integration_id: int, run: SyncRun | None, syncing: bool) -> SyncStatusOut:
    return SyncStatusOut(
        integration_id=integration_id,
        syncing=syncing or bool(run and run.status == SyncStatus.running),
        run=SyncRunOut.model_validate(run) if run else None,
    )


@router.post("/integrations/{integration_id}/sync", response_model=SyncStatusOut, status_code=202)
def trigger_sync(
    integration_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    get_or_404(db, Integration, integration_id)
    background.add_task(run_in_session, sync_integration, integration_id)
    return _status(integration_id, None, syncing=True)


@router.get("/integrations/{integration_id}/sync-status", response_model=SyncStatusOut)
def sync_status(integration_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Integration, integration_id)
    return _status(integration_id, _latest_run(db, integration_id), syncing=False)


@router.get("/projects/{project_id}/sync-runs", response_model=list[SyncRunListItem])
def sync_runs(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    integ_ids = [
        i.id
        for i in db.execute(
            select(Integration).where(Integration.project_id == project_id)
        ).scalars()
    ]
    if not integ_ids:
        return []
    runs = db.execute(
        select(SyncRun)
        .where(SyncRun.integration_id.in_(integ_ids))
        .order_by(desc(SyncRun.started_at))
        .limit(15)
        .options(selectinload(SyncRun.integration))
    ).scalars().all()
    return [
        SyncRunListItem.model_validate(r).model_copy(
            update={"integration_type": r.integration.type.value}
        )
        for r in runs
    ]


@router.post("/repos/{repo_id}/sync", response_model=RepoSyncOut, status_code=202)
def trigger_repo_sync(
    repo_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    repo = get_or_404(db, GitRepo, repo_id, "Repo")
    repo.sync_status = "running"
    repo.sync_error = None
    db.commit()
    background.add_task(run_in_session, sync_repo, repo_id)
    return RepoSyncOut.model_validate(repo, from_attributes=True)


@router.get("/repos/{repo_id}/sync-status", response_model=RepoSyncOut)
def repo_sync_status(repo_id: int, db: Session = Depends(get_db)):
    repo = get_or_404(db, GitRepo, repo_id, "Repo")
    return RepoSyncOut.model_validate(repo, from_attributes=True)
