"""Sprint capacity API schemas (focus factor, allocated vs completed)."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.schemas.common import ApiModel


class SprintCapacityMemberOut(ApiModel):
    member_id: int
    display_name: str
    focus_factor: float
    allocated_points: float
    completed_points: float
    delta: float
    over_capacity: bool


class SprintCapacityOut(ApiModel):
    sprint_id: int
    name: str
    state: str | None
    start_date: date | None
    end_date: date | None
    working_days: int  # effective (override or computed)
    working_days_override: int | None  # the manual override, if set
    team_capacity: float
    team_completed: float
    members: list[SprintCapacityMemberOut]


class CapacityMemberIn(BaseModel):
    member_id: int
    focus_factor: float


class SprintCapacityIn(BaseModel):
    working_days: int | None = None
    members: list[CapacityMemberIn] = []
