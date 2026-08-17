"""Milestones and the roadmap they plot onto.

The read endpoints return derived numbers only — progress, spanned sprints and
the completion forecast are all computed from the linked tasks on the way out,
so nothing here can drift from what the Scrums board shows. See
app.services.milestones.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Project
from app.schemas.data import TaskOut
from app.schemas.milestone import (
    GenerateOut,
    GeneratePreviewOut,
    MilestoneCreateIn,
    MilestoneEpicGroupOut,
    MilestoneOut,
    MilestonePatchIn,
    MilestoneTasksIn,
    RoadmapOut,
)


class GenerateIn(BaseModel):
    """Which proposals to apply. None (omitted) = every ready one."""
    source_task_ids: list[int] | None = None
from app.services import milestones as milestone_svc

router = APIRouter()


@router.get("/projects/{project_id}/milestones", response_model=list[MilestoneOut])
def list_milestones(project_id: int, db: Session = Depends(get_db)):
    """Every milestone with its rollup — the List view's payload."""
    get_or_404(db, Project, project_id)
    return milestone_svc.build_milestones(db, project_id)


@router.get("/projects/{project_id}/roadmap", response_model=RoadmapOut)
def project_roadmap(project_id: int, db: Session = Depends(get_db)):
    """The roadmap canvas: milestones, sprint bands, and the date domain."""
    get_or_404(db, Project, project_id)
    return milestone_svc.build_roadmap(db, project_id)


@router.get(
    "/projects/{project_id}/milestones/generate/preview", response_model=GeneratePreviewOut
)
def preview_generate(project_id: int, db: Session = Depends(get_db)):
    """Dry run of "generate from sprints" — what it would create, no writes.

    GET because it is genuinely side-effect-free, and because the dialog polls
    it again after every change on the board.
    """
    get_or_404(db, Project, project_id)
    return milestone_svc.preview_generated(db, project_id)


@router.post("/projects/{project_id}/milestones/generate", response_model=GenerateOut)
def generate(project_id: int, body: GenerateIn, db: Session = Depends(get_db)):
    """Create a milestone per top-level epic, dated from the sprints its work sits in.

    Tasks already on a milestone are counted and left alone, so this is safe to
    re-run: it tops up rather than reshuffling. 200 rather than 201 — the
    response is a summary of a batch, not one created resource.
    """
    get_or_404(db, Project, project_id)
    return milestone_svc.generate_from_sprints(db, project_id, body.source_task_ids)


@router.post("/projects/{project_id}/milestones", response_model=MilestoneOut, status_code=201)
def create_milestone(
    project_id: int, body: MilestoneCreateIn, db: Session = Depends(get_db)
):
    get_or_404(db, Project, project_id)
    milestone = milestone_svc.create_milestone(db, project_id, body)
    return _one(db, project_id, milestone.id)


@router.patch("/projects/{project_id}/milestones/{milestone_id}", response_model=MilestoneOut)
def patch_milestone(
    project_id: int, milestone_id: int, body: MilestonePatchIn, db: Session = Depends(get_db)
):
    """Partial edit; omitted fields are left alone."""
    get_or_404(db, Project, project_id)
    milestone = milestone_svc.get_milestone(db, project_id, milestone_id)
    milestone_svc.patch_milestone(db, milestone, body)
    return _one(db, project_id, milestone_id)


@router.delete("/projects/{project_id}/milestones/{milestone_id}", status_code=204)
def delete_milestone(project_id: int, milestone_id: int, db: Session = Depends(get_db)):
    """Delete it; its tasks survive, unlinked."""
    get_or_404(db, Project, project_id)
    milestone = milestone_svc.get_milestone(db, project_id, milestone_id)
    milestone_svc.delete_milestone(db, milestone)


@router.get(
    "/projects/{project_id}/milestones/{milestone_id}/tasks", response_model=list[TaskOut]
)
def milestone_tasks(project_id: int, milestone_id: int, db: Session = Depends(get_db)):
    """Everything linked, containers included — what a person actually attached."""
    get_or_404(db, Project, project_id)
    milestone_svc.get_milestone(db, project_id, milestone_id)
    return milestone_svc.milestone_tasks(db, milestone_id)


@router.get(
    "/projects/{project_id}/milestones/{milestone_id}/epics",
    response_model=list[MilestoneEpicGroupOut],
)
def milestone_epics(project_id: int, milestone_id: int, db: Session = Depends(get_db)):
    """The same linked work as `/tasks`, grouped by the epic it belongs to.

    Grouping is derived from the task tree on read, so it can't drift from the
    board. One epic's tasks routinely span several sprints — the sprint is a
    field on each row here, not the grouping.
    """
    get_or_404(db, Project, project_id)
    milestone_svc.get_milestone(db, project_id, milestone_id)
    return milestone_svc.milestone_epics(db, milestone_id)


@router.post(
    "/projects/{project_id}/milestones/{milestone_id}/tasks", response_model=list[TaskOut]
)
def link_tasks(
    project_id: int, milestone_id: int, body: MilestoneTasksIn, db: Session = Depends(get_db)
):
    """Link tasks in bulk. Returns the full list so the sheet re-renders once."""
    get_or_404(db, Project, project_id)
    milestone = milestone_svc.get_milestone(db, project_id, milestone_id)
    milestone_svc.assign_tasks(db, milestone, body.task_ids)
    return milestone_svc.milestone_tasks(db, milestone_id)


@router.delete(
    "/projects/{project_id}/milestones/{milestone_id}/tasks/{task_id}", status_code=204
)
def unlink_task(
    project_id: int, milestone_id: int, task_id: int, db: Session = Depends(get_db)
):
    get_or_404(db, Project, project_id)
    milestone = milestone_svc.get_milestone(db, project_id, milestone_id)
    milestone_svc.unassign_task(db, milestone, task_id)


def _one(db: Session, project_id: int, milestone_id: int) -> MilestoneOut:
    """Re-read through the roadmap builder so a write returns the same shape a
    read does — rollup, derived sprints and forecast included, rather than a
    bare row the client would have to refetch to make useful."""
    roadmap = milestone_svc.build_roadmap(db, project_id)
    return next(m for m in roadmap.milestones if m.id == milestone_id)
