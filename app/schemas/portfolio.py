"""Cross-project portfolio: one health row per project the caller can see."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Health = Literal["green", "amber", "red", "unknown"]


class PortfolioSprint(BaseModel):
    """The project's active sprint, as far as it has got."""
    id: int
    name: str
    start_date: date | None
    end_date: date | None
    # The commitment it started with: stamped at start, else its first snapshot.
    baseline_points: float | None
    total_points: float
    completed_points: float
    # 0..1 of total_points.
    progress: float
    # (total - baseline) / baseline. None without a baseline.
    scope_change: float | None


class PortfolioMilestone(BaseModel):
    id: int
    name: str
    target_date: date | None
    forecast_date: date | None
    forecast_p85: date | None = None
    on_time_probability: float | None = None
    days_late: int | None
    health: str
    progress: float


class VelocityPoint(BaseModel):
    name: str
    completed_points: float


class PortfolioProject(BaseModel):
    id: int
    name: str
    key: str | None
    # The caller's role here; None for an admin who isn't a member.
    role: str | None
    health: Health
    # Why it isn't green, worst first. Empty when green.
    health_reasons: list[str]
    active_sprint: PortfolioSprint | None
    velocity_rolling3: float
    velocity_average: float
    # rolling3 / average; None until enough closed sprints to compare.
    velocity_trend: float | None
    # Last closed sprints, oldest first, for the sparkline.
    velocity_series: list[VelocityPoint]
    # health -> count over open (not released/cancelled) milestones.
    milestones_by_health: dict[str, int]
    next_milestone: PortfolioMilestone | None
    last_synced_at: datetime | None
    last_sync_failed: bool


class PortfolioOut(BaseModel):
    projects: list[PortfolioProject]
    generated_at: datetime
