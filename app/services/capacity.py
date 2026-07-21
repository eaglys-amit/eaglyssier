"""Sprint capacity: focus-factor allocation vs completed story points.

A member's *allocated* points for a sprint = focus_factor * the sprint's working
days (1 day = 1 point). *Completed* points = the story points of that member's
done tasks in the sprint. The two are compared per member and rolled up into a
team-capacity total per sprint. Focus factors live on SprintMemberCapacity;
working days come from Sprint.working_days or, unset, the business days between
the sprint's start/end dates.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Member,
    MemberIdentity,
    ProjectMember,
    Sprint,
    SprintMemberCapacity,
    StatusCategory,
    Task,
)
from app.schemas.capacity import SprintCapacityMemberOut, SprintCapacityOut


def business_days(start: date | None, end: date | None) -> int:
    """Mon-Fri day count between two dates, inclusive. 0 if either is missing."""
    if start is None or end is None or end < start:
        return 0
    days = 0
    d = start
    while d <= end:
        if d.weekday() < 5:  # 0-4 = Mon-Fri
            days += 1
        d += timedelta(days=1)
    return days


def effective_working_days(sprint: Sprint) -> int:
    """The sprint's working-days override, else business days between its dates."""
    if sprint.working_days is not None:
        return sprint.working_days
    return business_days(sprint.start_date, sprint.end_date)


def _allocated(focus_factor: float, working_days: int) -> float:
    return round(focus_factor * working_days, 1)


def completed_by_sprint_member(db: Session, project_id: int) -> dict[tuple[int, int], float]:
    """{(sprint_id, member_id): completed story points} for done, sprinted tasks."""
    rows = db.execute(
        select(
            Task.sprint_id,
            MemberIdentity.member_id,
            func.coalesce(func.sum(Task.story_points), 0.0),
        )
        .join(MemberIdentity, Task.assignee_identity_id == MemberIdentity.id)
        .where(
            Task.project_id == project_id,
            Task.status_category == StatusCategory.done,
            Task.sprint_id.is_not(None),
            MemberIdentity.member_id.is_not(None),
        )
        .group_by(Task.sprint_id, MemberIdentity.member_id)
    ).all()
    return {(sid, mid): float(total) for sid, mid, total in rows}


def build_project_capacity(db: Session, project_id: int) -> list[SprintCapacityOut]:
    """Per-sprint capacity matrix for every project member."""
    members = db.execute(
        select(Member)
        .join(ProjectMember, ProjectMember.member_id == Member.id)
        .where(ProjectMember.project_id == project_id)
        .order_by(Member.display_name)
    ).scalars().all()

    sprints = db.execute(
        select(Sprint)
        .where(Sprint.project_id == project_id)
        .order_by(Sprint.start_date.desc().nullslast())
    ).scalars().all()

    focus = {
        (c.sprint_id, c.member_id): c.focus_factor
        for c in db.execute(
            select(SprintMemberCapacity).join(
                Sprint, SprintMemberCapacity.sprint_id == Sprint.id
            ).where(Sprint.project_id == project_id)
        ).scalars()
    }
    completed = completed_by_sprint_member(db, project_id)

    out: list[SprintCapacityOut] = []
    for s in sprints:
        wd = effective_working_days(s)
        member_rows: list[SprintCapacityMemberOut] = []
        team_capacity = 0.0
        team_completed = 0.0
        for m in members:
            ff = focus.get((s.id, m.id), 0.0)
            alloc = _allocated(ff, wd)
            done = round(completed.get((s.id, m.id), 0.0), 1)
            team_capacity += alloc
            team_completed += done
            member_rows.append(
                SprintCapacityMemberOut(
                    member_id=m.id,
                    display_name=m.display_name,
                    focus_factor=ff,
                    allocated_points=alloc,
                    completed_points=done,
                    delta=round(done - alloc, 1),
                    over_capacity=done > alloc,
                )
            )
        out.append(
            SprintCapacityOut(
                sprint_id=s.id,
                name=s.name,
                state=s.state,
                start_date=s.start_date,
                end_date=s.end_date,
                working_days=wd,
                working_days_override=s.working_days,
                team_capacity=round(team_capacity, 1),
                team_completed=round(team_completed, 1),
                members=member_rows,
            )
        )
    return out


def build_sprint_capacity(
    db: Session, project_id: int, sprint_id: int
) -> SprintCapacityOut | None:
    """Capacity for a single sprint (used after a PUT)."""
    for s in build_project_capacity(db, project_id):
        if s.sprint_id == sprint_id:
            return s
    return None


def allocated_points_for_scope(
    db: Session, project_id: int, member_id: int, sprint_ids: frozenset[int]
) -> float:
    """Sum of a member's allocated points over the given sprints (all project
    sprints when sprint_ids is empty). Used by KPI generation."""
    stmt = select(Sprint).where(Sprint.project_id == project_id)
    if sprint_ids:
        stmt = stmt.where(Sprint.id.in_(sprint_ids))
    sprints = db.execute(stmt).scalars().all()
    if not sprints:
        return 0.0
    focus = {
        c.sprint_id: c.focus_factor
        for c in db.execute(
            select(SprintMemberCapacity).where(
                SprintMemberCapacity.member_id == member_id,
                SprintMemberCapacity.sprint_id.in_([s.id for s in sprints]),
            )
        ).scalars()
    }
    total = sum(_allocated(focus.get(s.id, 0.0), effective_working_days(s)) for s in sprints)
    return round(total, 1)
