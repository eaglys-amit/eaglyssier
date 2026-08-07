"""Make the per-project story-point scale actually do something.

``StoryPointScale`` has existed since migration 0016 as a reference table that
nothing consumed. This module gives it three jobs:

* **The deck** — its ``points`` values are the only estimates the UI offers, so
  an estimate can never be a number the team doesn't use.
* **Breakdown pressure** — a value flagged ``needs_breakdown`` (13 by default)
  is a signal to split the work, so estimating a childless task at one is
  surfaced as a violation.
* **Reality check** — ``min_hours``/``max_hours`` describe what a value is meant
  to cost. A done task whose logged hours fall outside its band means either the
  estimate or the scale is wrong, and both are worth knowing.

Plus scale reuse: a project can import another project's scale instead of
re-typing it.
"""
from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Project, StatusCategory, StoryPointScale, Task
from app.schemas.settings import DeckOut, ScaleSourceOut, ScaleViolationOut
from app.services import tasks as tasks_svc


def _rows(db: Session, project_id: int) -> list[StoryPointScale]:
    return list(
        db.execute(
            select(StoryPointScale)
            .where(StoryPointScale.project_id == project_id)
            .order_by(StoryPointScale.points)
        ).scalars().all()
    )


def build_deck(db: Session, project_id: int) -> DeckOut:
    """The card deck: allowed values, and which of them demand a breakdown."""
    rows = _rows(db, project_id)
    return DeckOut(
        points=[r.points for r in rows],
        needs_breakdown=[r.points for r in rows if r.needs_breakdown],
        labels={str(r.points): r.note for r in rows if r.note},
    )


def nearest_point(db: Session, project_id: int, value: float | None) -> float | None:
    """Snap an off-deck estimate to the closest value the scale defines.

    Used when a model proposes an estimate: better to land on a neighbouring
    card than to introduce a value the team has no shared meaning for.
    """
    if value is None:
        return None
    deck = [r.points for r in _rows(db, project_id)]
    if not deck:
        return value
    return float(min(deck, key=lambda p: (abs(p - value), p)))


def scale_sources(db: Session, project_id: int) -> list[ScaleSourceOut]:
    """Other projects with a scale worth copying, largest first."""
    counts = dict(
        db.execute(
            select(StoryPointScale.project_id, func.count(StoryPointScale.id))
            .group_by(StoryPointScale.project_id)
        ).all()
    )
    out: list[ScaleSourceOut] = []
    for project in db.execute(select(Project).order_by(Project.name)).scalars():
        if project.id == project_id or project.id not in counts:
            continue
        out.append(
            ScaleSourceOut(
                project_id=project.id,
                project_name=project.name,
                project_key=project.key,
                row_count=counts[project.id],
            )
        )
    return out


def import_scale(
    db: Session, project_id: int, source_project_id: int, *, mode: str = "replace"
) -> list[StoryPointScale]:
    """Copy another project's scale in.

    ``replace`` mirrors the source exactly, matching how PUT /story-points
    already behaves (whole-scale replace). ``merge`` keeps rows this project
    already defines and only adds point values it is missing, so a locally
    tuned band isn't silently overwritten.
    """
    source = _rows(db, source_project_id)
    if mode == "replace":
        db.execute(delete(StoryPointScale).where(StoryPointScale.project_id == project_id))
        db.flush()
        existing: set[int] = set()
    else:
        existing = {r.points for r in _rows(db, project_id)}

    for row in source:
        if row.points in existing:
            continue
        db.add(
            StoryPointScale(
                project_id=project_id,
                points=row.points,
                min_hours=row.min_hours,
                max_hours=row.max_hours,
                risk=row.risk,
                needs_breakdown=row.needs_breakdown,
                note=row.note,
            )
        )
    db.commit()
    return _rows(db, project_id)


def check_estimate(
    db: Session, project_id: int, task: Task, points: float | None
) -> list[str]:
    """Warnings for a proposed estimate. Advisory — never blocks the write.

    Called when applying a poker result or accepting an AI breakdown, so the
    person deciding sees the same guidance the scale encodes.
    """
    if points is None:
        return []
    warnings: list[str] = []
    rows = _rows(db, project_id)
    if not rows:
        return warnings

    match = next((r for r in rows if r.points == points), None)
    if match is None:
        allowed = ", ".join(str(r.points) for r in rows)
        warnings.append(f"{points:g} is not on this project's scale ({allowed}).")
    elif match.needs_breakdown and not db.execute(
        select(1).where(Task.parent_id == task.id).limit(1)
    ).scalar():
        warnings.append(
            f"The scale flags {match.points} as too big to work on directly — "
            "split it into subtasks first."
        )
    return warnings


def scale_violations(db: Session, project_id: int) -> list[ScaleViolationOut]:
    """Tasks whose estimate disagrees with the scale.

    Three kinds:
      * ``off_deck``        — estimated at a value the scale doesn't define
      * ``needs_breakdown`` — estimated at a break-it-down value, no subtasks
      * ``hours_below_min`` / ``hours_above_max`` — done, and the logged hours
        fall outside the band that estimate promised

    Leaves only: a container's own points are not the work, and its logged hours
    are its children's.
    """
    rows = _rows(db, project_id)
    if not rows:
        return []
    by_points = {r.points: r for r in rows}

    tasks = db.execute(
        tasks_svc.leaf_only(
            select(Task).where(
                Task.project_id == project_id, Task.story_points.is_not(None)
            )
        ).order_by(Task.rank, Task.id)
    ).scalars().all()
    child_of = tasks_svc.parent_ids(db, project_id)

    out: list[ScaleViolationOut] = []
    for task in tasks:
        points = task.story_points or 0.0
        label = tasks_svc.task_label(task)
        row = by_points.get(int(points)) if float(points).is_integer() else None

        if row is None:
            allowed = ", ".join(str(r.points) for r in rows)
            out.append(
                ScaleViolationOut(
                    task_id=task.id, task_key=label, title=task.title, kind="off_deck",
                    points=points, hours=None, min_hours=None, max_hours=None,
                    message=f"Estimated {points:g}, which is not on the scale ({allowed}).",
                )
            )
            continue

        if row.needs_breakdown and task.id not in child_of:
            out.append(
                ScaleViolationOut(
                    task_id=task.id, task_key=label, title=task.title,
                    kind="needs_breakdown", points=points, hours=None,
                    min_hours=row.min_hours, max_hours=row.max_hours,
                    message=(
                        f"Estimated {points:g}, which the scale says to break down, "
                        "but it has no subtasks."
                    ),
                )
            )

        # Hours only mean something once the work is finished and logged.
        hours = round((task.worklog_seconds or 0) / 3600.0, 1)
        if task.status_category != StatusCategory.done or hours <= 0:
            continue
        if row.min_hours is not None and hours < row.min_hours:
            out.append(
                ScaleViolationOut(
                    task_id=task.id, task_key=label, title=task.title,
                    kind="hours_below_min", points=points, hours=hours,
                    min_hours=row.min_hours, max_hours=row.max_hours,
                    message=(
                        f"Took {hours:g}h — under the {row.min_hours:g}h floor for "
                        f"{points:g} points, so it was over-estimated."
                    ),
                )
            )
        elif row.max_hours is not None and hours > row.max_hours:
            out.append(
                ScaleViolationOut(
                    task_id=task.id, task_key=label, title=task.title,
                    kind="hours_above_max", points=points, hours=hours,
                    min_hours=row.min_hours, max_hours=row.max_hours,
                    message=(
                        f"Took {hours:g}h — over the {row.max_hours:g}h ceiling for "
                        f"{points:g} points, so it was under-estimated."
                    ),
                )
            )
    return out
