"""Sprint lifecycle schemas: create/edit, start, complete, commitment meter."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.schemas.common import ApiModel


class SprintCreateIn(BaseModel):
    name: str
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    # future | active | closed. Mirrors the values Jira sync writes, so local
    # and synced sprints render identically everywhere downstream.
    state: str | None = "future"
    working_days: int | None = None


class SprintPatchIn(BaseModel):
    """Partial edit; omitted fields are left alone (see TaskPatchIn)."""
    name: str | None = None
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    state: str | None = None
    working_days: int | None = None


class SprintCompleteIn(BaseModel):
    # Where unfinished tasks go. None = the backlog.
    move_incomplete_to: int | None = None


class SprintCompleteOut(BaseModel):
    sprint_id: int
    completed_tasks: int
    completed_points: float
    moved_tasks: int
    moved_to_sprint_id: int | None


class SprintCommitmentOut(ApiModel):
    """Planned vs available: the board's commitment meter."""
    sprint_id: int
    name: str
    committed_points: float  # leaf story points currently in the sprint
    completed_points: float
    # Team capacity = sum(focus_factor x working days). None when no member has
    # a focus factor set, in which case the meter renders as "no capacity set"
    # rather than as 0% used.
    capacity_points: float | None
    working_days: int
    unestimated_tasks: int
    over_capacity: bool
