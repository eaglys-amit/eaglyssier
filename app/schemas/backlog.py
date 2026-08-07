"""Backlog board schemas: local task CRUD, rank moves, and the board payload."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.schemas.common import ApiModel
from app.schemas.data import TaskOut

# Status categories a caller may set directly. Mirrors models.StatusCategory,
# spelled out here so the API contract doesn't depend on the enum's repr.
StatusCategoryIn = str  # "todo" | "in_progress" | "done"


class TaskCreateIn(BaseModel):
    title: str
    description: str | None = None
    acceptance_criteria: str | None = None
    issue_type: str | None = None
    status: str | None = None
    status_category: StatusCategoryIn = "todo"
    story_points: float | None = None
    priority: str | None = None
    sprint_id: int | None = None
    parent_id: int | None = None
    # The curated Member; resolved to one of their MemberIdentity rows in this
    # project, because Task.assignee is an identity, not a member.
    assignee_member_id: int | None = None


class TaskPatchIn(BaseModel):
    """Partial edit. Omitted fields are left alone.

    `None` is a meaningful value here — it clears the sprint, unassigns, or
    drops the estimate — so patch_task distinguishes "omitted" from "set to
    null" via `model_dump(exclude_unset=True)` rather than by checking None.
    """
    title: str | None = None
    description: str | None = None
    acceptance_criteria: str | None = None
    issue_type: str | None = None
    status: str | None = None
    status_category: StatusCategoryIn | None = None
    story_points: float | None = None
    priority: str | None = None
    sprint_id: int | None = None
    parent_id: int | None = None
    assignee_member_id: int | None = None


class RankMoveIn(BaseModel):
    """Positional move. The server owns the rank value.

    `after_task_id` is the row this task should follow in the target list;
    None puts it first. Clients send positions, never ranks, so a client that
    has drifted from the server's ordering can't corrupt it.
    """
    sprint_id: int | None = None  # None = the backlog
    after_task_id: int | None = None


class BulkMoveIn(BaseModel):
    task_ids: list[int] = []
    sprint_id: int | None = None  # None = the backlog


class TaskNodeOut(TaskOut):
    """A task with its breakdown subtree, for the tree view."""
    children: list["TaskNodeOut"] = []
    # Points rolled up from leaf descendants; equals story_points for a leaf.
    rollup_points: float = 0.0


class BacklogSprintBucket(ApiModel):
    sprint_id: int
    name: str
    state: str | None
    source: str
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    tasks: list[TaskOut] = []
    # Leaf story points planned into this sprint.
    committed_points: float = 0.0
    completed_points: float = 0.0
    # Team capacity from app.services.capacity (focus factor x working days).
    # None when nobody has a focus factor set for the sprint.
    capacity_points: float | None = None


class BacklogOut(BaseModel):
    """Everything the board needs in one fetch."""
    backlog: list[TaskOut] = []
    sprints: list[BacklogSprintBucket] = []
    backlog_points: float = 0.0
