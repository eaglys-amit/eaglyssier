"""Sprint lifecycle for locally-created sprints: create, edit, start, complete.

Local sprints live in the same ``sprints`` table as Jira's, distinguished by
``source``. Only local sprints may be edited here — a synced sprint's name and
dates are the connector's to own, and letting the UI change them would just
produce edits that silently vanish on the next sync.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Sprint, StatusCategory, Task
from app.schemas.scrum import (
    SprintCommitmentOut,
    SprintCompleteIn,
    SprintCompleteOut,
    SprintCreateIn,
    SprintPatchIn,
)
from app.services import tasks as tasks_svc
from app.services.backlog import unestimated_count
from app.services.capacity import build_project_capacity, effective_working_days


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_local(sprint: Sprint) -> None:
    if sprint.source != "local":
        raise HTTPException(
            409,
            "This sprint is owned by a connector — edit it in the source system, "
            "or the next sync will overwrite your changes.",
        )


def get_sprint(db: Session, project_id: int, sprint_id: int) -> Sprint:
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.project_id != project_id:
        raise HTTPException(404, "Sprint not found")
    return sprint


def create_sprint(db: Session, project_id: int, data: SprintCreateIn) -> Sprint:
    if data.start_date and data.end_date and data.end_date < data.start_date:
        raise HTTPException(422, "The sprint ends before it starts")
    sprint = Sprint(
        project_id=project_id,
        source="local",
        external_id=None,
        name=data.name.strip(),
        goal=data.goal,
        start_date=data.start_date,
        end_date=data.end_date,
        state=(data.state or "future").strip() or "future",
        working_days=data.working_days,
    )
    db.add(sprint)
    db.commit()
    db.refresh(sprint)
    return sprint


def patch_sprint(db: Session, sprint: Sprint, data: SprintPatchIn) -> Sprint:
    _require_local(sprint)
    fields = data.model_dump(exclude_unset=True)
    if "name" in fields and fields["name"] is not None:
        fields["name"] = fields["name"].strip()
    for key, value in fields.items():
        setattr(sprint, key, value)
    if sprint.start_date and sprint.end_date and sprint.end_date < sprint.start_date:
        raise HTTPException(422, "The sprint ends before it starts")
    db.commit()
    db.refresh(sprint)
    return sprint


def delete_sprint(db: Session, sprint: Sprint) -> None:
    """Delete a local sprint; its tasks fall back to the backlog.

    Mirrors the synced-sprint delete in app.api.routes.data — tasks are never
    destroyed as a side effect of removing their container.
    """
    _require_local(sprint)
    db.query(Task).filter(Task.sprint_id == sprint.id).update(
        {Task.sprint_id: None}, synchronize_session=False
    )
    db.delete(sprint)
    db.commit()


def start_sprint(db: Session, sprint: Sprint) -> Sprint:
    """Mark the sprint active and freeze what was committed at kickoff.

    ``committed_points`` is the burndown's baseline, so it is stamped once and
    deliberately not recomputed later — that is what makes mid-sprint scope
    change visible instead of silently rebasing the chart.
    """
    _require_local(sprint)
    sprint.state = "active"
    sprint.committed_points = _leaf_points(db, sprint.id)
    db.commit()
    db.refresh(sprint)
    return sprint


def complete_sprint(
    db: Session, sprint: Sprint, data: SprintCompleteIn
) -> SprintCompleteOut:
    """Close the sprint and rehome whatever didn't finish."""
    _require_local(sprint)
    if data.move_incomplete_to is not None:
        target = db.get(Sprint, data.move_incomplete_to)
        if target is None or target.project_id != sprint.project_id:
            raise HTTPException(404, "Target sprint not found")
        if target.id == sprint.id:
            raise HTTPException(422, "Cannot move unfinished work into the same sprint")

    unfinished = db.execute(
        select(Task).where(
            Task.sprint_id == sprint.id,
            Task.status_category != StatusCategory.done,
        )
    ).scalars().all()
    for task in unfinished:
        task.sprint_id = data.move_incomplete_to

    done = db.execute(
        select(Task).where(
            Task.sprint_id == sprint.id,
            Task.status_category == StatusCategory.done,
        )
    ).scalars().all()

    sprint.state = "closed"
    sprint.complete_date = _now().date()
    db.commit()

    return SprintCompleteOut(
        sprint_id=sprint.id,
        completed_tasks=len(done),
        completed_points=_leaf_points(db, sprint.id, done_only=True),
        moved_tasks=len(unfinished),
        moved_to_sprint_id=data.move_incomplete_to,
    )


def _leaf_points(db: Session, sprint_id: int, *, done_only: bool = False) -> float:
    """Story points in a sprint, counting leaves only (no double-counted trees)."""
    stmt = select(Task).where(Task.sprint_id == sprint_id)
    if done_only:
        stmt = stmt.where(Task.status_category == StatusCategory.done)
    rows = db.execute(tasks_svc.leaf_only(stmt)).scalars().all()
    return round(sum(t.story_points or 0.0 for t in rows), 1)


def build_sprint_commitment(
    db: Session, project_id: int, sprint_id: int
) -> SprintCommitmentOut:
    """Planned vs available points — the board's commitment meter."""
    sprint = get_sprint(db, project_id, sprint_id)
    committed = _leaf_points(db, sprint_id)
    capacity = next(
        (
            s.team_capacity
            for s in build_project_capacity(db, project_id)
            if s.sprint_id == sprint_id
        ),
        0.0,
    )
    # 0 means nobody has a focus factor set, which is "unknown", not "no room".
    capacity_points = capacity if capacity > 0 else None
    return SprintCommitmentOut(
        sprint_id=sprint_id,
        name=sprint.name,
        committed_points=committed,
        completed_points=_leaf_points(db, sprint_id, done_only=True),
        capacity_points=capacity_points,
        working_days=effective_working_days(sprint),
        unestimated_tasks=unestimated_count(db, project_id, sprint_id),
        over_capacity=capacity_points is not None and committed > capacity_points,
    )
