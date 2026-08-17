"""Shared guards for tasks and sprints that may be local or connector-synced.

Two invariants live here, and both are silent-corruption bugs if a call site
forgets them:

1. **Leaves only when summing story points.** A parent (epic) and its subtasks
   both carry points, so an unfiltered ``SUM(Task.story_points)`` counts the
   tree twice. Those sums feed capacity, KPI, MBO evaluation grades and the
   generated PDFs, none of which anyone independently sanity-checks. Use
   :func:`leaf_only`.

2. **Sync must never touch local rows.** ``source == 'local'`` rows are
   hand-created in the Scrums tab and no re-sync can recreate them. Use
   :func:`sync_scoped` on every sync upsert and every bulk delete.
"""
from __future__ import annotations

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, aliased

from app.models import Sprint, Task

# Sparse ordering step for the backlog board. Wide enough that midpoint inserts
# between neighbours stay integral for ~10 levels before a renumber is needed.
RANK_STEP = 1000


def task_label(task: Task) -> str:
    """Display/prompt handle for a task: the Jira key, or '#<id>' if local.

    ``Task.external_key`` is NULL for locally-created tasks, so anything that
    renders or prompts with a key must go through here rather than reading the
    column directly.
    """
    return task.external_key or f"#{task.id}"


# Enough to tell two tasks apart in a list without wrapping to a paragraph.
_PREVIEW_CHARS = 240


def description_preview(text: str | None) -> str | None:
    """One clipped line of a description, for list rows.

    Collapses whitespace so a multi-line body doesn't turn a card into a wall,
    and clips on a word boundary so it doesn't end mid-word.
    """
    if not text:
        return None
    flat = " ".join(text.split())
    if len(flat) <= _PREVIEW_CHARS:
        return flat
    clipped = flat[:_PREVIEW_CHARS]
    cut = clipped.rfind(" ")
    return f"{clipped[:cut] if cut > 40 else clipped}…"


def leaf_only(stmt: Select) -> Select:
    """Narrow a Task select to leaves — tasks with no children.

    Every story-point SUM must use this. See the module docstring.
    """
    child = aliased(Task)
    return stmt.where(
        ~select(1).where(child.parent_id == Task.id).exists()
    )


def sync_scoped(stmt: Select, model: type[Sprint] | type[Task]) -> Select:
    """Narrow a Sprint/Task select to connector-owned rows.

    Sync upserts and the bulk deletes in app.api.routes.data must all carry
    this, or hand-created planning work gets overwritten or destroyed.
    """
    return stmt.where(model.source == "sync")


def is_leaf(db: Session, task_id: int) -> bool:
    """True when the task has no children."""
    return not db.execute(
        select(1).where(Task.parent_id == task_id).limit(1)
    ).scalar()


def parent_ids(db: Session, project_id: int) -> set[int]:
    """Ids of every task in the project that has at least one child.

    Cheaper than a correlated subquery when the caller already holds the task
    list in memory and only needs to partition it.
    """
    rows = db.execute(
        select(Task.parent_id)
        .where(Task.project_id == project_id, Task.parent_id.is_not(None))
        .distinct()
    ).scalars().all()
    return set(rows)


def descendants(db: Session, task_id: int) -> list[Task]:
    """Every task below `task_id`, breadth-first.

    Iterative rather than a recursive CTE: breakdown trees are capped at three
    levels, so the loop runs at most a handful of times and stays readable.
    """
    out: list[Task] = []
    frontier = [task_id]
    seen = {task_id}
    while frontier:
        rows = db.execute(
            select(Task).where(Task.parent_id.in_(frontier))
        ).scalars().all()
        frontier = []
        for row in rows:
            if row.id in seen:
                continue  # defensive: a cycle would otherwise loop forever
            seen.add(row.id)
            out.append(row)
            frontier.append(row.id)
    return out


def roots_of(db: Session, tasks: list[Task]) -> dict[int, Task | None]:
    """Map each task to the root of its breakdown tree — its epic.

    "Epic" is structural here, not a label, the same definition the roadmap uses
    (see milestones._plan_from_epics): the parentless task at the top of a tree
    that has children. A task that *is* its own root maps to None — it's
    standalone work, not an epic's child.

    Batched level by level rather than one walk per task: a queue of thirty rows
    costs a couple of queries, not thirty. Iterative like `descendants` for the
    same reason — trees are capped at three levels.
    """
    by_id: dict[int, Task] = {t.id: t for t in tasks}
    frontier = {t.parent_id for t in tasks if t.parent_id is not None} - by_id.keys()

    # The cap is a guard against a cycle in the data, not an expected depth.
    for _ in range(10):
        if not frontier:
            break
        rows = db.execute(select(Task).where(Task.id.in_(frontier))).scalars().all()
        for row in rows:
            by_id[row.id] = row
        frontier = {
            r.parent_id for r in rows if r.parent_id is not None
        } - by_id.keys()

    out: dict[int, Task | None] = {}
    for task in tasks:
        cursor = task
        seen = {task.id}
        while cursor.parent_id is not None:
            parent = by_id.get(cursor.parent_id)
            # A missing parent means the walk ran past what we loaded; a seen one
            # means a cycle. Either way the highest row reached is the best answer.
            if parent is None or parent.id in seen:
                break
            seen.add(parent.id)
            cursor = parent
        out[task.id] = cursor if cursor.id != task.id else None
    return out


def would_cycle(db: Session, task_id: int, new_parent_id: int | None) -> bool:
    """True when re-parenting `task_id` under `new_parent_id` closes a loop."""
    if new_parent_id is None:
        return False
    if new_parent_id == task_id:
        return True
    seen = {task_id}
    cursor: int | None = new_parent_id
    while cursor is not None:
        if cursor in seen:
            return True
        seen.add(cursor)
        cursor = db.execute(
            select(Task.parent_id).where(Task.id == cursor)
        ).scalar_one_or_none()
    return False


def next_rank(db: Session, project_id: int) -> int:
    """Rank that places a new task at the bottom of the project's backlog."""
    highest = db.execute(
        select(func.max(Task.rank)).where(Task.project_id == project_id)
    ).scalar()
    return int(highest or 0) + RANK_STEP


def renumber(db: Session, project_id: int) -> None:
    """Re-space every rank in the project to RANK_STEP multiples.

    Called when a midpoint insert runs out of room between two neighbours.
    Does not commit — the caller owns the transaction.
    """
    tasks = db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .order_by(Task.rank, Task.id)
    ).scalars().all()
    for position, task in enumerate(tasks, start=1):
        task.rank = position * RANK_STEP
    db.flush()
