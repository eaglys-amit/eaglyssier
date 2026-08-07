"""Burndown and velocity.

Burndown is the one metric here that can't be derived from current state: you
need what remained on *each* day, so it has to be sampled. Snapshots are written
by the daily scheduler job and, so a dev instance with the scheduler off isn't
permanently empty, also on every read.

Days with no snapshot stay absent from the series rather than being interpolated.
A straight line through a gap reads as "no work happened", which is a claim the
data doesn't support.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Sprint, SprintSnapshot, StatusCategory, Task
from app.schemas.scrum import (
    BurndownOut,
    BurndownPoint,
    VelocityOut,
    VelocityRow,
)
from app.services import tasks as tasks_svc
from app.services.capacity import build_project_capacity, effective_working_days

log = logging.getLogger("app.services.burndown")


def _leaf_tasks(db: Session, sprint_id: int) -> list[Task]:
    """Leaves only: a container's points are its children's, counted twice otherwise."""
    return list(
        db.execute(
            tasks_svc.leaf_only(select(Task).where(Task.sprint_id == sprint_id))
        ).scalars().all()
    )


def snapshot_sprint(
    db: Session, sprint_id: int, on: date | None = None, *, backfilled: bool = False
) -> SprintSnapshot | None:
    """Upsert one day's reading. Idempotent on (sprint_id, snapshot_date)."""
    sprint = db.get(Sprint, sprint_id)
    if sprint is None:
        return None
    day = on or date.today()

    tasks = _leaf_tasks(db, sprint_id)
    total = round(sum(t.story_points or 0.0 for t in tasks), 1)
    done = [t for t in tasks if t.status_category == StatusCategory.done]
    completed = round(sum(t.story_points or 0.0 for t in done), 1)

    row = db.execute(
        select(SprintSnapshot).where(
            SprintSnapshot.sprint_id == sprint_id, SprintSnapshot.snapshot_date == day
        )
    ).scalar_one_or_none()
    if row is None:
        row = SprintSnapshot(sprint_id=sprint_id, snapshot_date=day)
        db.add(row)

    row.total_points = total
    row.remaining_points = round(total - completed, 1)
    row.completed_points = completed
    row.total_tasks = len(tasks)
    row.completed_tasks = len(done)
    row.backfilled = backfilled
    db.commit()
    db.refresh(row)
    return row


def backfill_snapshots(db: Session, sprint_id: int) -> int:
    """Reconstruct history from resolved_at_src, for sprints predating the feature.

    Approximate on purpose, and flagged as such: this can recover *when work
    finished*, but not when a task entered or left the sprint, so mid-sprint
    scope changes are invisible in a backfilled series.
    """
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or not sprint.start_date:
        return 0
    tasks = _leaf_tasks(db, sprint_id)
    if not tasks:
        return 0

    total = round(sum(t.story_points or 0.0 for t in tasks), 1)
    last = min(sprint.end_date or date.today(), date.today())
    written = 0
    day = sprint.start_date
    while day <= last:
        # Everything resolved on or before `day` counts as done by then.
        completed = round(
            sum(
                t.story_points or 0.0
                for t in tasks
                if t.resolved_at_src is not None and t.resolved_at_src.date() <= day
            ),
            1,
        )
        row = db.execute(
            select(SprintSnapshot).where(
                SprintSnapshot.sprint_id == sprint_id, SprintSnapshot.snapshot_date == day
            )
        ).scalar_one_or_none()
        # Never overwrite a real reading with a reconstructed one.
        if row is None:
            db.add(
                SprintSnapshot(
                    sprint_id=sprint_id,
                    snapshot_date=day,
                    total_points=total,
                    remaining_points=round(total - completed, 1),
                    completed_points=completed,
                    total_tasks=len(tasks),
                    completed_tasks=len(
                        [
                            t
                            for t in tasks
                            if t.resolved_at_src is not None
                            and t.resolved_at_src.date() <= day
                        ]
                    ),
                    backfilled=True,
                )
            )
            written += 1
        day += timedelta(days=1)
    db.commit()
    return written


def build_burndown(db: Session, project_id: int, sprint_id: int) -> BurndownOut | None:
    """Actual remaining vs the ideal line, sampling today on the way through."""
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.project_id != project_id:
        return None

    # Read-time sampling: keeps history accruing without a scheduler.
    if sprint.state != "closed":
        snapshot_sprint(db, sprint_id)

    rows = list(
        db.execute(
            select(SprintSnapshot)
            .where(SprintSnapshot.sprint_id == sprint_id)
            .order_by(SprintSnapshot.snapshot_date)
        ).scalars().all()
    )
    tasks = _leaf_tasks(db, sprint_id)
    total = round(sum(t.story_points or 0.0 for t in tasks), 1)
    completed = round(
        sum(
            t.story_points or 0.0
            for t in tasks
            if t.status_category == StatusCategory.done
        ),
        1,
    )
    # committed_points is frozen at sprint start; before that, current scope is
    # the only baseline available.
    committed = sprint.committed_points if sprint.committed_points is not None else total

    return BurndownOut(
        sprint_id=sprint.id,
        sprint_name=sprint.name,
        state=sprint.state,
        start_date=sprint.start_date,
        end_date=sprint.end_date,
        committed_points=round(committed, 1),
        total_points=total,
        completed_points=completed,
        remaining_points=round(total - completed, 1),
        working_days=effective_working_days(sprint),
        approximate=any(r.backfilled for r in rows),
        points=[
            BurndownPoint(
                date=r.snapshot_date,
                remaining_points=r.remaining_points,
                completed_points=r.completed_points,
                total_points=r.total_points,
                backfilled=r.backfilled,
            )
            for r in rows
        ],
    )


def build_velocity(db: Session, project_id: int, limit: int = 12) -> VelocityOut:
    """Completed points per sprint, plus the averages that suggest a next commitment.

    Only sprints that have started are included: an unstarted sprint has nothing
    to say about throughput and would drag the average toward zero.
    """
    sprints = list(
        db.execute(
            select(Sprint)
            .where(Sprint.project_id == project_id)
            .order_by(Sprint.start_date.asc().nullslast(), Sprint.id)
        ).scalars().all()
    )
    capacity = {
        s.sprint_id: (s.team_capacity if s.team_capacity > 0 else None)
        for s in build_project_capacity(db, project_id)
    }

    rows: list[VelocityRow] = []
    for sprint in sprints:
        if sprint.state not in ("active", "closed"):
            continue
        tasks = _leaf_tasks(db, sprint.id)
        if not tasks and sprint.committed_points is None:
            continue
        total = round(sum(t.story_points or 0.0 for t in tasks), 1)
        completed = round(
            sum(
                t.story_points or 0.0
                for t in tasks
                if t.status_category == StatusCategory.done
            ),
            1,
        )
        rows.append(
            VelocityRow(
                sprint_id=sprint.id,
                name=sprint.name,
                state=sprint.state,
                end_date=sprint.end_date,
                committed_points=round(
                    sprint.committed_points if sprint.committed_points is not None else total, 1
                ),
                completed_points=completed,
                capacity_points=capacity.get(sprint.id),
            )
        )

    rows = rows[-limit:]
    # An in-flight sprint is a partial number, so it doesn't vote on the average.
    settled = [r for r in rows if r.state == "closed"]
    average = round(sum(r.completed_points for r in settled) / len(settled), 1) if settled else 0.0
    recent = settled[-3:]
    rolling3 = (
        round(sum(r.completed_points for r in recent) / len(recent), 1) if recent else 0.0
    )
    return VelocityOut(
        sprints=rows,
        average=average,
        rolling3=rolling3,
        closed_count=len(settled),
    )


def snapshot_all_active(db: Session) -> int:
    """Scheduler entry point: sample every active sprint. Never raises."""
    written = 0
    try:
        sprint_ids = list(
            db.execute(select(Sprint.id).where(Sprint.state == "active")).scalars().all()
        )
        for sprint_id in sprint_ids:
            if snapshot_sprint(db, sprint_id) is not None:
                written += 1
    except Exception as exc:  # noqa: BLE001 - a scheduled job must not crash the loop
        log.warning("sprint snapshot job failed: %s", exc)
    return written
