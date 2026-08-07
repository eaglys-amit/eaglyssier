"""AI task breakdown: generate a draft tree, edit it, accept it as real tasks."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404, run_in_session
from app.db import get_db
from app.models import Project, Task, TaskBreakdown
from app.schemas.breakdown import (
    BreakdownAcceptIn,
    BreakdownAcceptOut,
    BreakdownCreateIn,
    BreakdownDraftIn,
    TaskBreakdownOut,
)
from app.services import breakdown as bd
from app.services import tasks as tasks_svc

router = APIRouter()


def _out(db: Session, row: TaskBreakdown) -> TaskBreakdownOut:
    parent = db.get(Task, row.parent_task_id) if row.parent_task_id else None
    return TaskBreakdownOut.model_validate(row).model_copy(
        update={
            "reference_filenames": bd.resolve_filenames(db, row.reference_file_ids),
            "parent_task_key": tasks_svc.task_label(parent) if parent else None,
        }
    )


@router.get("/projects/{project_id}/breakdowns", response_model=list[TaskBreakdownOut])
def list_breakdowns(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    rows = db.execute(
        select(TaskBreakdown)
        .where(TaskBreakdown.project_id == project_id)
        .order_by(TaskBreakdown.id.desc())
    ).scalars().all()
    return [_out(db, r) for r in rows]


@router.post(
    "/projects/{project_id}/breakdowns", response_model=TaskBreakdownOut, status_code=202
)
def create_breakdown(
    project_id: int,
    body: BreakdownCreateIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Kick off generation. Returns immediately at status='running'; poll for it."""
    get_or_404(db, Project, project_id)
    if not body.reference_file_ids:
        raise HTTPException(422, "Select at least one reference document to work from.")
    if body.parent_task_id is not None:
        task = get_or_404(db, Task, body.parent_task_id, "Task")
        if task.project_id != project_id:
            raise HTTPException(404, "Task not found in this project")

    row = bd.create_breakdown(db, project_id, body)
    if not bd.claim(db, row):
        raise HTTPException(409, "That breakdown is already running")
    background.add_task(run_in_session, bd.generate_breakdown, row.id)
    return _out(db, row)


@router.get("/breakdowns/{breakdown_id}", response_model=TaskBreakdownOut)
def get_breakdown(breakdown_id: int, db: Session = Depends(get_db)):
    """The 2s poll target while a draft is being generated."""
    row = get_or_404(db, TaskBreakdown, breakdown_id, "Breakdown")
    return _out(db, row)


@router.post(
    "/breakdowns/{breakdown_id}/regenerate", response_model=TaskBreakdownOut, status_code=202
)
def regenerate_breakdown(
    breakdown_id: int, background: BackgroundTasks, db: Session = Depends(get_db)
):
    """Re-run the model with the same documents and instructions."""
    row = get_or_404(db, TaskBreakdown, breakdown_id, "Breakdown")
    if not bd.claim(db, row):
        raise HTTPException(409, "That breakdown is already running")
    background.add_task(run_in_session, bd.generate_breakdown, row.id)
    return _out(db, row)


@router.put("/breakdowns/{breakdown_id}/draft", response_model=TaskBreakdownOut)
def save_draft(breakdown_id: int, body: BreakdownDraftIn, db: Session = Depends(get_db)):
    """Persist the user's edits. Re-validated exactly like the model's output."""
    row = get_or_404(db, TaskBreakdown, breakdown_id, "Breakdown")
    if row.status == "running":
        raise HTTPException(409, "Wait for the current generation to finish")
    return _out(db, bd.save_draft(db, row, body.nodes))


@router.post(
    "/breakdowns/{breakdown_id}/accept", response_model=BreakdownAcceptOut, status_code=201
)
def accept_breakdown(
    breakdown_id: int, body: BreakdownAcceptIn, db: Session = Depends(get_db)
):
    """Create real tasks from the selected nodes.

    Synchronous — no model call — so this returns 201 with the created ids
    rather than 202.
    """
    row = get_or_404(db, TaskBreakdown, breakdown_id, "Breakdown")
    if row.status == "running":
        raise HTTPException(409, "Wait for the current generation to finish")
    if row.status == "accepted":
        raise HTTPException(409, "This breakdown has already been accepted")
    if row.status != "ready":
        raise HTTPException(409, "There is no draft to accept yet")

    created, warnings = bd.accept_breakdown(db, row, body.node_ids, body.sprint_id)
    return BreakdownAcceptOut(
        breakdown_id=row.id,
        created=len(created),
        task_ids=[t.id for t in created],
        warnings=warnings,
    )


@router.delete("/breakdowns/{breakdown_id}", status_code=204)
def delete_breakdown(breakdown_id: int, db: Session = Depends(get_db)):
    """Tolerant delete. Tasks already created from it are kept."""
    row = db.get(TaskBreakdown, breakdown_id)
    if row is not None:
        db.delete(row)
        db.commit()
