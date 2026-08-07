"""Sprint lifecycle for locally-created sprints, plus the commitment meter.

Read and bulk-delete endpoints for sprints stay in app.api.routes.data — this
module owns the write side. `GET /projects/{id}/sprints` and
`DELETE /sprints/{id}` there and `POST`/`PATCH` here share paths but not
methods, so there is no routing conflict.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Project
from app.schemas.data import SprintOut
from app.schemas.scrum import (
    BurndownOut,
    SnapshotOut,
    SprintCommitmentOut,
    SprintCompleteIn,
    SprintCompleteOut,
    SprintCreateIn,
    SprintPatchIn,
    VelocityOut,
)
from app.services import burndown as burndown_svc
from app.services import scrum as scrum_svc

router = APIRouter()


@router.post("/projects/{project_id}/sprints", response_model=SprintOut, status_code=201)
def create_sprint(project_id: int, body: SprintCreateIn, db: Session = Depends(get_db)):
    """Create a source='local' sprint. Sync never touches it."""
    get_or_404(db, Project, project_id)
    return scrum_svc.create_sprint(db, project_id, body)


@router.patch("/projects/{project_id}/sprints/{sprint_id}", response_model=SprintOut)
def patch_sprint(
    project_id: int, sprint_id: int, body: SprintPatchIn, db: Session = Depends(get_db)
):
    """Edit a local sprint. 409 for a connector-owned one."""
    get_or_404(db, Project, project_id)
    sprint = scrum_svc.get_sprint(db, project_id, sprint_id)
    return scrum_svc.patch_sprint(db, sprint, body)


@router.delete("/projects/{project_id}/sprints/{sprint_id}", status_code=204)
def delete_local_sprint(project_id: int, sprint_id: int, db: Session = Depends(get_db)):
    """Delete a local sprint; its tasks fall back to the backlog."""
    get_or_404(db, Project, project_id)
    sprint = scrum_svc.get_sprint(db, project_id, sprint_id)
    scrum_svc.delete_sprint(db, sprint)


@router.post("/projects/{project_id}/sprints/{sprint_id}/start", response_model=SprintOut)
def start_sprint(project_id: int, sprint_id: int, db: Session = Depends(get_db)):
    """Mark active and freeze committed_points as the burndown baseline."""
    get_or_404(db, Project, project_id)
    sprint = scrum_svc.get_sprint(db, project_id, sprint_id)
    return scrum_svc.start_sprint(db, sprint)


@router.post(
    "/projects/{project_id}/sprints/{sprint_id}/complete",
    response_model=SprintCompleteOut,
)
def complete_sprint(
    project_id: int, sprint_id: int, body: SprintCompleteIn, db: Session = Depends(get_db)
):
    """Close the sprint; unfinished tasks move to the target sprint or backlog."""
    get_or_404(db, Project, project_id)
    sprint = scrum_svc.get_sprint(db, project_id, sprint_id)
    return scrum_svc.complete_sprint(db, sprint, body)


@router.get(
    "/projects/{project_id}/sprints/{sprint_id}/commitment",
    response_model=SprintCommitmentOut,
)
def sprint_commitment(project_id: int, sprint_id: int, db: Session = Depends(get_db)):
    """Planned points vs team capacity — the board's commitment meter."""
    get_or_404(db, Project, project_id)
    return scrum_svc.build_sprint_commitment(db, project_id, sprint_id)


@router.get(
    "/projects/{project_id}/sprints/{sprint_id}/burndown", response_model=BurndownOut
)
def sprint_burndown(project_id: int, sprint_id: int, db: Session = Depends(get_db)):
    """Remaining points per day against the ideal line.

    Samples today on the way through, so history accrues even with the scheduler
    off. Days with no reading are absent rather than interpolated.
    """
    get_or_404(db, Project, project_id)
    result = burndown_svc.build_burndown(db, project_id, sprint_id)
    if result is None:
        raise HTTPException(404, "Sprint not found")
    return result


@router.post(
    "/projects/{project_id}/sprints/{sprint_id}/snapshot", response_model=SnapshotOut
)
def snapshot_sprint(project_id: int, sprint_id: int, db: Session = Depends(get_db)):
    """Record today's reading now. Cheap and synchronous, so 200 rather than 202."""
    get_or_404(db, Project, project_id)
    scrum_svc.get_sprint(db, project_id, sprint_id)
    row = burndown_svc.snapshot_sprint(db, sprint_id)
    return SnapshotOut(sprint_id=sprint_id, written=1 if row else 0)


@router.post(
    "/projects/{project_id}/sprints/{sprint_id}/backfill-snapshots",
    response_model=SnapshotOut,
)
def backfill_snapshots(project_id: int, sprint_id: int, db: Session = Depends(get_db)):
    """Reconstruct history from resolved dates for a sprint that predates snapshots.

    Approximate: it recovers when work finished, not when scope changed. The
    resulting points are flagged so the chart can say so.
    """
    get_or_404(db, Project, project_id)
    scrum_svc.get_sprint(db, project_id, sprint_id)
    written = burndown_svc.backfill_snapshots(db, sprint_id)
    return SnapshotOut(sprint_id=sprint_id, written=written)


@router.get("/projects/{project_id}/velocity", response_model=VelocityOut)
def project_velocity(project_id: int, limit: int = 12, db: Session = Depends(get_db)):
    """Completed points per started sprint, with the averages for a next commitment."""
    get_or_404(db, Project, project_id)
    return burndown_svc.build_velocity(db, project_id, limit=limit)
