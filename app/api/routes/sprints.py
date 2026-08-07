"""Sprint lifecycle for locally-created sprints, plus the commitment meter.

Read and bulk-delete endpoints for sprints stay in app.api.routes.data — this
module owns the write side. `GET /projects/{id}/sprints` and
`DELETE /sprints/{id}` there and `POST`/`PATCH` here share paths but not
methods, so there is no routing conflict.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Project
from app.schemas.data import SprintOut
from app.schemas.scrum import (
    SprintCommitmentOut,
    SprintCompleteIn,
    SprintCompleteOut,
    SprintCreateIn,
    SprintPatchIn,
)
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
