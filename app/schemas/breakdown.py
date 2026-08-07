"""AI task-breakdown API schemas.

Nodes are a **flat list with string parent refs**, not a nested structure.
Models emit flat lists far more reliably than deep nesting, and the accept step
wants a topological walk anyway; the UI nests them for display.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.common import ApiModel, JobStatus

BreakdownLevel = Literal["epic", "task", "subtask"]


class BreakdownNode(BaseModel):
    """One drafted work item."""
    id: str  # stable within the draft; referenced by children's `parent`
    parent: str | None = None
    level: BreakdownLevel = "task"
    title: str
    description: str | None = None
    acceptance_criteria: str | None = None
    issue_type: str | None = None
    # Leaves only. A node with children carries no points — its children's roll up.
    story_points: float | None = None
    priority: str | None = None
    rationale: str | None = None


class BreakdownDraft(BaseModel):
    nodes: list[BreakdownNode] = []


class BreakdownCreateIn(BaseModel):
    title: str | None = None
    instructions: str | None = None
    reference_file_ids: list[int] = []
    sprint_id: int | None = None
    # Break down an existing task: accepted nodes land under it.
    parent_task_id: int | None = None


class BreakdownDraftIn(BaseModel):
    """User edits to the draft. Re-validated exactly like the model's output."""
    nodes: list[BreakdownNode] = []


class BreakdownAcceptIn(BaseModel):
    # Node ids to create. Ancestors of a selected node are pulled in
    # automatically — a subtask can't be created without its parent.
    node_ids: list[str] = []
    # Overrides the breakdown's own sprint when set.
    sprint_id: int | None = None


class TaskBreakdownOut(ApiModel):
    id: int
    project_id: int
    sprint_id: int | None
    parent_task_id: int | None
    parent_task_key: str | None = None
    title: str
    instructions: str | None
    reference_file_ids: list[int] = []
    # Filenames resolved for display, so the UI needn't join against the files.
    reference_filenames: list[str] = []
    status: JobStatus | Literal["accepted"]
    draft: BreakdownDraft | None = None
    error: str | None
    model: str | None
    created_at: datetime | None = None
    generated_at: datetime | None
    accepted_at: datetime | None
    created_task_ids: list[int] = []


class BreakdownAcceptOut(BaseModel):
    breakdown_id: int
    created: int
    task_ids: list[int] = []
    # Advisory scale warnings across the created tasks (see services.scale).
    warnings: list[str] = []
