"""Backlog board: local task CRUD, positional rank moves, the board payload."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Project, Task
from app.schemas.backlog import (
    BacklogOut,
    BulkMoveIn,
    RankMoveIn,
    TaskCreateIn,
    TaskLinkKeyIn,
    TaskNodeOut,
    TaskPatchIn,
)
from app.schemas.data import TaskOut
from app.services import backlog as backlog_svc

router = APIRouter()


@router.get("/projects/{project_id}/backlog-board", response_model=BacklogOut)
def backlog_board(project_id: int, db: Session = Depends(get_db)):
    """Ranked backlog plus per-sprint buckets and capacity, in one fetch.

    Named `backlog-board` because `DELETE /projects/{id}/backlog` already exists
    in app.api.routes.data with different semantics (clear synced backlog rows).
    """
    get_or_404(db, Project, project_id)
    return backlog_svc.build_backlog(db, project_id)


@router.get("/projects/{project_id}/task-tree", response_model=list[TaskNodeOut])
def task_tree(project_id: int, db: Session = Depends(get_db)):
    """Nested epic/task/subtask forest with leaf points rolled up."""
    get_or_404(db, Project, project_id)
    return backlog_svc.build_task_tree(db, project_id)


@router.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=201)
def create_task(project_id: int, body: TaskCreateIn, db: Session = Depends(get_db)):
    """Create a source='local' task. Sync never touches it."""
    get_or_404(db, Project, project_id)
    task = backlog_svc.create_task(db, project_id, body)
    return backlog_svc.task_out(task)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def patch_task(task_id: int, body: TaskPatchIn, db: Session = Depends(get_db)):
    """Partial edit.

    Allowed on synced tasks: the local-only fields (parent, priority,
    acceptance criteria, rank) survive a re-sync, but title/status/points are
    connector-owned and will be overwritten the next time it runs.
    """
    task = get_or_404(db, Task, task_id, "Task")
    return backlog_svc.task_out(backlog_svc.patch_task(db, task, body))


@router.post("/tasks/{task_id}/jira-key", response_model=TaskOut)
def link_jira_key(task_id: int, body: TaskLinkKeyIn, db: Session = Depends(get_db)):
    """Link a local task to the tracker issue an engineer created from it.

    The row stays local until a sync finds that key and adopts it, so the
    estimate and the epic/milestone grouping made here survive the hand-off
    instead of arriving back as a second, unstructured row. Send a null key to
    undo a typo. 409 if another task in the project already claims the key.
    """
    task = get_or_404(db, Task, task_id, "Task")
    return backlog_svc.task_out(backlog_svc.link_external_key(db, task, body))


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, cascade: bool = False, db: Session = Depends(get_db)):
    """Tolerant delete. Children are promoted unless `cascade=true`."""
    backlog_svc.delete_task(db, task_id, cascade=cascade)


@router.post("/tasks/{task_id}/rank", response_model=TaskOut)
def move_task(task_id: int, body: RankMoveIn, db: Session = Depends(get_db)):
    """The drag-drop op: move to a sprint (or the backlog) at a position.

    The body is positional (`after_task_id`), never a rank — the server owns
    the ordering values so a stale client can't corrupt them.
    """
    task = get_or_404(db, Task, task_id, "Task")
    return backlog_svc.task_out(backlog_svc.move_task(db, task, body))


@router.post("/projects/{project_id}/tasks/bulk-move", response_model=list[TaskOut])
def bulk_move(project_id: int, body: BulkMoveIn, db: Session = Depends(get_db)):
    """Move a multi-selection into one sprint, appended in the order given."""
    get_or_404(db, Project, project_id)
    moved = backlog_svc.bulk_move(db, project_id, body)
    return [backlog_svc.task_out(t) for t in moved]


@router.post("/tasks/{task_id}/subtasks", response_model=TaskOut, status_code=201)
def create_subtask(task_id: int, body: TaskCreateIn, db: Session = Depends(get_db)):
    """Add a child under an existing task (convenience over create + patch)."""
    parent = get_or_404(db, Task, task_id, "Task")
    data = body.model_copy(update={"parent_id": parent.id})
    if data.sprint_id is None:
        data = data.model_copy(update={"sprint_id": parent.sprint_id})
    task = backlog_svc.create_task(db, parent.project_id, data)
    return backlog_svc.task_out(task)
