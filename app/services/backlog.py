"""Local task CRUD, backlog ranking, and the board payload.

Everything here creates ``source='local'`` rows in the same ``tasks`` table the
Jira connector writes to, so the Gantt, Capacity, KPI, Evaluation and Reports
features pick up hand-planned work with no changes of their own.

Two rules make that work, and both are easy to break:

* **Ranks are positional on the wire.** Callers send "put this after task N",
  never a rank value. :func:`move_task` computes the midpoint, and renumbers
  the project when two neighbours have no gap left between them.
* **Local tasks carry connector timestamps too.** ``created_at_src`` on create,
  ``started_at_src`` on the first move into in_progress, ``resolved_at_src`` on
  done. Four downstream subsystems (scope filtering, period reports, the Gantt,
  commit attribution) key off those columns, so leaving them NULL would make
  local work invisible to all of them.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import MemberIdentity, Milestone, Sprint, StatusCategory, Task
from app.schemas.backlog import (
    BacklogOut,
    BacklogSprintBucket,
    BulkMoveIn,
    RankMoveIn,
    TaskCreateIn,
    TaskNodeOut,
    TaskPatchIn,
)
from app.schemas.data import TaskOut
from app.services import tasks as tasks_svc
from app.services.capacity import build_project_capacity


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _category(value: str | None) -> StatusCategory:
    try:
        return StatusCategory(value or "todo")
    except ValueError:
        raise HTTPException(422, f"Unknown status category: {value!r}") from None


def _resolve_assignee(db: Session, project_id: int, member_id: int | None) -> int | None:
    """Map a curated Member to one of their identities in this project.

    Task.assignee is a MemberIdentity, not a Member, because that is what sync
    discovers. A local task assigned to someone with no discovered account in
    this project simply stays unassigned rather than failing the write —
    identity mapping is a separate, optional step on the Members page.
    """
    if member_id is None:
        return None
    return db.execute(
        select(MemberIdentity.id)
        .where(
            MemberIdentity.project_id == project_id,
            MemberIdentity.member_id == member_id,
        )
        .order_by(MemberIdentity.id)
        .limit(1)
    ).scalar_one_or_none()


def _apply_category(task: Task, category: StatusCategory) -> None:
    """Set the category and stamp the matching *_src transition timestamp."""
    if category == StatusCategory.in_progress and task.started_at_src is None:
        task.started_at_src = _now()
    if category == StatusCategory.done:
        if task.started_at_src is None:
            # Jumped straight to done without ever being in progress; without a
            # start the cycle-time sample in metrics._flow_metrics is dropped.
            task.started_at_src = _now()
        task.resolved_at_src = _now()
    elif task.resolved_at_src is not None:
        task.resolved_at_src = None  # reopened
    task.status_category = category


def _check_sprint(db: Session, project_id: int, sprint_id: int | None) -> None:
    if sprint_id is None:
        return
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.project_id != project_id:
        raise HTTPException(404, "Sprint not found")


def _check_milestone(db: Session, project_id: int, milestone_id: int | None) -> None:
    if milestone_id is None:
        return
    milestone = db.get(Milestone, milestone_id)
    if milestone is None or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found")


def _check_parent(db: Session, task: Task | None, project_id: int, parent_id: int | None) -> None:
    if parent_id is None:
        return
    parent = db.get(Task, parent_id)
    if parent is None or parent.project_id != project_id:
        raise HTTPException(404, "Parent task not found")
    if task is not None and tasks_svc.would_cycle(db, task.id, parent_id):
        raise HTTPException(422, "That parent would create a loop in the breakdown tree")


# ---------------------------------------------------------------- task CRUD


def create_task(db: Session, project_id: int, data: TaskCreateIn) -> Task:
    _check_sprint(db, project_id, data.sprint_id)
    _check_milestone(db, project_id, data.milestone_id)
    _check_parent(db, None, project_id, data.parent_id)

    task = Task(
        project_id=project_id,
        source="local",
        external_key=None,
        title=data.title.strip(),
        description=data.description,
        acceptance_criteria=data.acceptance_criteria,
        issue_type=data.issue_type,
        status=data.status,
        story_points=data.story_points,
        estimate_source="manual" if data.story_points is not None else None,
        priority=data.priority,
        sprint_id=data.sprint_id,
        milestone_id=data.milestone_id,
        parent_id=data.parent_id,
        assignee_identity_id=_resolve_assignee(db, project_id, data.assignee_member_id),
        rank=tasks_svc.next_rank(db, project_id),
        created_at_src=_now(),
        updated_at_src=_now(),
    )
    _apply_category(task, _category(data.status_category))
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def patch_task(db: Session, task: Task, data: TaskPatchIn) -> Task:
    """Apply a partial edit.

    Works on synced tasks too — the fields a connector owns will be overwritten
    on the next sync, which is the caller's problem to surface, but the local
    -only fields (parent_id, priority, acceptance_criteria) survive.
    """
    fields = data.model_dump(exclude_unset=True)

    if "sprint_id" in fields:
        _check_sprint(db, task.project_id, fields["sprint_id"])
    if "milestone_id" in fields:
        _check_milestone(db, task.project_id, fields["milestone_id"])
    if "parent_id" in fields:
        _check_parent(db, task, task.project_id, fields["parent_id"])
    if "assignee_member_id" in fields:
        task.assignee_identity_id = _resolve_assignee(
            db, task.project_id, fields.pop("assignee_member_id")
        )
    if "status_category" in fields:
        _apply_category(task, _category(fields.pop("status_category")))
    if "title" in fields and fields["title"] is not None:
        fields["title"] = fields["title"].strip()
    if "story_points" in fields:
        # Editing the number by hand settles it, so it stops being a proposal.
        task.estimate_source = "manual" if fields["story_points"] is not None else None

    for key, value in fields.items():
        setattr(task, key, value)

    task.updated_at_src = _now()
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task_id: int, *, cascade: bool = False) -> None:
    """Tolerant delete. By default children are promoted, not destroyed.

    ``cascade=True`` removes the whole subtree — used when the user deletes an
    epic they never wanted. The default relies on the FK's ON DELETE SET NULL.
    """
    task = db.get(Task, task_id)
    if task is None:
        return
    if cascade:
        for child in tasks_svc.descendants(db, task_id):
            db.delete(child)
    db.delete(task)
    db.commit()


# ------------------------------------------------------------------ ranking


def move_task(db: Session, task: Task, data: RankMoveIn) -> Task:
    """Move a task to a sprint (or the backlog) at a given position."""
    _check_sprint(db, task.project_id, data.sprint_id)

    after: Task | None = None
    if data.after_task_id is not None:
        after = db.get(Task, data.after_task_id)
        if after is None or after.project_id != task.project_id:
            raise HTTPException(404, "Anchor task not found")
        if after.id == task.id:
            raise HTTPException(422, "A task cannot be positioned after itself")

    task.sprint_id = data.sprint_id
    task.rank = _rank_after(db, task, data.sprint_id, after)
    task.updated_at_src = _now()
    db.commit()
    db.refresh(task)
    return task


def _rank_after(
    db: Session, task: Task, sprint_id: int | None, after: Task | None
) -> int:
    """Midpoint rank placing `task` directly after `after` in the target list.

    Renumbers the project and retries once if the neighbours have no integer
    between them. One retry is always enough: after a renumber every gap is
    RANK_STEP wide.
    """
    rank = _try_rank_after(db, task, sprint_id, after)
    if rank is not None:
        return rank
    tasks_svc.renumber(db, task.project_id)
    db.refresh(task)
    if after is not None:
        db.refresh(after)
    rank = _try_rank_after(db, task, sprint_id, after)
    if rank is None:  # pragma: no cover - renumber guarantees a gap
        raise HTTPException(500, "Could not find a rank slot after renumbering")
    return rank


def _try_rank_after(
    db: Session, task: Task, sprint_id: int | None, after: Task | None
) -> int | None:
    """The midpoint, or None when the neighbours are already adjacent."""
    siblings = db.execute(
        select(Task)
        .where(
            Task.project_id == task.project_id,
            Task.sprint_id.is_(None) if sprint_id is None else Task.sprint_id == sprint_id,
            Task.id != task.id,
        )
        .order_by(Task.rank, Task.id)
    ).scalars().all()

    if after is None:
        lower, upper = None, siblings[0].rank if siblings else None
    else:
        index = next((i for i, s in enumerate(siblings) if s.id == after.id), None)
        if index is None:
            # The anchor isn't in the target list (the client's view is stale);
            # appending is the least surprising thing to do.
            lower, upper = (siblings[-1].rank if siblings else None), None
        else:
            lower = siblings[index].rank
            upper = siblings[index + 1].rank if index + 1 < len(siblings) else None

    if lower is None and upper is None:
        return tasks_svc.RANK_STEP
    if lower is None:
        return upper - tasks_svc.RANK_STEP
    if upper is None:
        return lower + tasks_svc.RANK_STEP
    if upper - lower > 1:
        return (lower + upper) // 2
    return None  # neighbours are adjacent — caller renumbers and retries


def bulk_move(db: Session, project_id: int, data: BulkMoveIn) -> list[Task]:
    """Move several tasks to one sprint, appending in the order given."""
    _check_sprint(db, project_id, data.sprint_id)
    moved: list[Task] = []
    rank = tasks_svc.next_rank(db, project_id)
    for task_id in data.task_ids:
        task = db.get(Task, task_id)
        if task is None or task.project_id != project_id:
            continue  # tolerant: a stale id in a multi-select shouldn't 404
        task.sprint_id = data.sprint_id
        task.rank = rank
        task.updated_at_src = _now()
        rank += tasks_svc.RANK_STEP
        moved.append(task)
    db.commit()
    for task in moved:
        db.refresh(task)
    return moved


# ------------------------------------------------------------- board payload


def task_out(task: Task) -> TaskOut:
    return TaskOut.model_validate(task).model_copy(
        update={
            "status_category": task.status_category.value,
            "description_preview": tasks_svc.description_preview(task.description),
            "assignee_name": _identity_name(task.assignee),
            "assignee_member_id": task.assignee.member_id if task.assignee else None,
        }
    )


def _identity_name(ident: MemberIdentity | None) -> str | None:
    if ident is None:
        return None
    return ident.display_name or ident.username or ident.email


def build_backlog(db: Session, project_id: int) -> BacklogOut:
    """The board's single fetch: ranked backlog, sprint buckets, capacity."""
    rows = db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .order_by(Task.rank, Task.id)
        .options(selectinload(Task.assignee))
    ).scalars().all()

    sprints = db.execute(
        select(Sprint)
        .where(Sprint.project_id == project_id)
        .order_by(Sprint.start_date.desc().nullslast(), Sprint.id.desc())
    ).scalars().all()

    # Points are summed over leaves only, so an epic and its subtasks don't
    # both count toward the sprint's commitment.
    container_ids = {t.parent_id for t in rows if t.parent_id is not None}

    def points(task: Task) -> float:
        if task.id in container_ids:
            return 0.0
        return task.story_points or 0.0

    capacity = {
        s.sprint_id: (s.team_capacity if s.team_capacity > 0 else None)
        for s in build_project_capacity(db, project_id)
    }

    buckets: dict[int, BacklogSprintBucket] = {
        s.id: BacklogSprintBucket(
            sprint_id=s.id,
            name=s.name,
            state=s.state,
            source=s.source,
            goal=s.goal,
            start_date=s.start_date,
            end_date=s.end_date,
            capacity_points=capacity.get(s.id),
        )
        for s in sprints
    }

    out = BacklogOut()
    for task in rows:
        item = task_out(task)
        bucket = buckets.get(task.sprint_id) if task.sprint_id else None
        if bucket is None:
            out.backlog.append(item)
            out.backlog_points += points(task)
            continue
        bucket.tasks.append(item)
        bucket.committed_points += points(task)
        if task.status_category == StatusCategory.done:
            bucket.completed_points += points(task)

    out.backlog_points = round(out.backlog_points, 1)
    for bucket in buckets.values():
        bucket.committed_points = round(bucket.committed_points, 1)
        bucket.completed_points = round(bucket.completed_points, 1)
    out.sprints = [buckets[s.id] for s in sprints]
    return out


def build_task_tree(db: Session, project_id: int) -> list[TaskNodeOut]:
    """Nested epic/task/subtask forest with leaf points rolled up."""
    rows = db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .order_by(Task.rank, Task.id)
        .options(selectinload(Task.assignee))
    ).scalars().all()

    nodes = {t.id: TaskNodeOut(**task_out(t).model_dump()) for t in rows}
    roots: list[TaskNodeOut] = []
    for task in rows:
        node = nodes[task.id]
        parent = nodes.get(task.parent_id) if task.parent_id else None
        # A parent outside this project (impossible via the API, but a stale FK
        # would orphan the row) falls back to top level rather than vanishing.
        if parent is None or parent is node:
            roots.append(node)
        else:
            parent.children.append(node)

    def rollup(node: TaskNodeOut) -> float:
        if not node.children:
            node.rollup_points = node.story_points or 0.0
        else:
            node.rollup_points = round(sum(rollup(c) for c in node.children), 1)
        return node.rollup_points

    for root in roots:
        rollup(root)
    return roots


def unestimated_count(db: Session, project_id: int, sprint_id: int) -> int:
    """Leaf tasks in the sprint with no story points — the meter's caveat."""
    stmt = select(func.count(Task.id)).where(
        Task.project_id == project_id,
        Task.sprint_id == sprint_id,
        Task.story_points.is_(None),
    )
    return int(db.execute(tasks_svc.leaf_only(stmt)).scalar() or 0)
