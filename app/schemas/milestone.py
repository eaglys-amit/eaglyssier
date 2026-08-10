"""Milestone schemas: CRUD, the task link, and the roadmap payload.

A milestone carries no stored progress. Every number below is derived on read
from the tasks pointing at it — see app.services.milestones.
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.schemas.common import ApiModel


class MilestoneCreateIn(BaseModel):
    name: str
    description: str | None = None
    start_date: date | None = None
    target_date: date | None = None
    # planned | in_progress | released | cancelled
    state: str = "planned"


class MilestonePatchIn(BaseModel):
    """Partial edit; omitted fields are left alone (see TaskPatchIn)."""
    name: str | None = None
    description: str | None = None
    start_date: date | None = None
    target_date: date | None = None
    state: str | None = None
    released_date: date | None = None
    rank: int | None = None


class MilestoneTasksIn(BaseModel):
    task_ids: list[int] = []


class MilestoneSprintRef(ApiModel):
    """A sprint this milestone has work in.

    Derived, never stored: it is the distinct set of sprints over the
    milestone's leaf tasks, so `points_in_milestone` across these rows sums to
    the milestone's `total_points` (backlog work lands in the sprint_id=None
    row, which is omitted here and shows as the difference).
    """
    sprint_id: int
    name: str
    state: str | None
    start_date: date | None
    end_date: date | None
    points_in_milestone: float = 0.0


class MilestoneOut(ApiModel):
    id: int
    project_id: int
    name: str
    description: str | None = None
    # NULL start_date falls back to the earliest linked sprint's start so the
    # roadmap bar always has a left edge; the resolved value is what ships.
    start_date: date | None = None
    target_date: date | None = None
    state: str
    rank: int = 0

    # ---- rollup: leaf tasks only, or an epic double-counts its subtasks ----
    total_points: float = 0.0
    completed_points: float = 0.0
    remaining_points: float = 0.0
    total_tasks: int = 0
    completed_tasks: int = 0
    unestimated_tasks: int = 0
    # 0..1. Points-based; falls back to the task count when nothing is
    # estimated, so a milestone of unpointed work still shows movement.
    progress: float = 0.0

    sprints: list[MilestoneSprintRef] = []

    # ---- forecast: from rolling-3 velocity, the Scrums charts' number ----
    # None when velocity is 0 (nothing to project from) or nothing remains.
    forecast_date: date | None = None
    # forecast_date - target_date in days. Negative = ahead of the date.
    days_late: int | None = None
    # on_track | at_risk | overdue | complete | unknown
    health: str = "unknown"


class RoadmapSprintBand(ApiModel):
    """A sprint band on the roadmap's timeline lane. Needs both dates to plot."""
    sprint_id: int
    name: str
    state: str | None
    start_date: date
    end_date: date


class RoadmapOut(BaseModel):
    """Everything the roadmap canvas needs in one fetch."""
    milestones: list[MilestoneOut] = []
    sprints: list[RoadmapSprintBand] = []
    # Canvas domain. None when there is nothing dated to plot.
    range_start: date | None = None
    range_end: date | None = None
    # Echoed so the UI can explain the forecast rather than just assert it.
    velocity_rolling3: float = 0.0
    velocity_average: float = 0.0
    # Median sprint span, the unit the forecast steps in. 14 when unknowable.
    sprint_length_days: int = 14


# ------------------------------------------------------- generate from sprints

class GeneratedTaskRef(ApiModel):
    """One leaf task a proposal would claim, and whether it actually can."""
    task_id: int
    # task_label(): the Jira key, or '#<id>' when local.
    key: str
    title: str
    story_points: float | None = None
    sprint_name: str | None = None
    # link | skip. Skipped tasks already belong to a milestone; the generator
    # never takes work away from one.
    action: str = "link"
    # The milestone already holding it, so the preview can say why it's skipped.
    held_by: str | None = None


class GeneratedMilestone(ApiModel):
    """A milestone the generator proposes, derived from one top-level epic."""
    source_task_id: int
    source_key: str
    name: str
    # From the sprints the epic's leaves sit in: earliest start, latest end.
    start_date: date | None = None
    target_date: date | None = None
    sprint_names: list[str] = []
    tasks: list[GeneratedTaskRef] = []
    link_count: int = 0
    skip_count: int = 0
    # Points of the tasks it would actually link.
    total_points: float = 0.0
    # create  = a new milestone
    # top_up  = link the new leaves to the milestone a previous run already made
    #           for this epic, rather than duplicating it
    mode: str = "create"
    # The milestone a top_up would extend.
    existing_milestone_id: int | None = None
    # Set when this proposal can't be applied, with the reason. A proposal with
    # a conflict is still shown — silently dropping it looks like a bug.
    conflict: str | None = None


class GeneratePreviewOut(BaseModel):
    """A dry run. Computed by the same function that applies, so it can't lie."""
    strategy: str = "epic"
    proposals: list[GeneratedMilestone] = []
    # Proposals that would do something (no conflict, something to link).
    ready_count: int = 0
    # Of those, how many are new milestones vs top-ups of existing ones.
    create_count: int = 0
    top_up_count: int = 0
    total_link_count: int = 0
    total_skip_count: int = 0


class GenerateOut(BaseModel):
    created: int = 0
    # Existing milestones that gained newly-linked work.
    updated: int = 0
    linked: int = 0
    skipped: int = 0
    milestones: list[MilestoneOut] = []
