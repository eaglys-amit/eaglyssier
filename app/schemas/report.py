"""Typed report context. Each section template consumes a slice of this model."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class TaskItem(BaseModel):
    # task_label(): the Jira key, or '#<id>' for locally-created tasks.
    # Optional so one local task can't fail report generation for the project.
    key: str | None = None
    title: str
    issue_type: str | None = None
    status: str | None = None
    status_category: str = "todo"
    story_points: float | None = None
    hours: float = 0.0


class MemberReport(BaseModel):
    member_id: int
    name: str
    email: str | None = None
    # story points
    assigned_sp: float = 0.0
    completed_sp: float = 0.0
    # task counts
    tasks_total: int = 0
    tasks_done: int = 0
    tasks_in_progress: int = 0
    tasks_todo: int = 0
    hours: float = 0.0
    # git contribution
    commits: int = 0
    additions: int = 0
    deletions: int = 0
    prs_opened: int = 0
    prs_merged: int = 0
    reviews_given: int = 0
    # per-member flow timings (objective)
    lead_median_days: float | None = None
    cycle_median_days: float | None = None
    tasks: list[TaskItem] = Field(default_factory=list)

    @property
    def completion_rate(self) -> float:
        return round(100 * self.completed_sp / self.assigned_sp, 1) if self.assigned_sp else 0.0

    @property
    def avg_sp_per_task(self) -> float:
        return round(self.completed_sp / self.tasks_done, 1) if self.tasks_done else 0.0


class DeliverableItem(BaseModel):
    name: str
    description: str | None = None
    status: str = "done"
    linked_task_keys: list[str] = Field(default_factory=list)


class SprintInfo(BaseModel):
    name: str
    state: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    goal: str | None = None


class DataQuality(BaseModel):
    tasks_without_points: int = 0
    unassigned_tasks: int = 0
    reopened_tasks: int = 0


class ReportSummary(BaseModel):
    assigned_sp: float = 0.0
    completed_sp: float = 0.0
    total_tasks: int = 0
    tasks_done: int = 0
    tasks_in_progress: int = 0
    tasks_todo: int = 0
    total_hours: float = 0.0
    num_members: int = 0
    num_commits: int = 0
    num_prs: int = 0

    @property
    def completion_rate(self) -> float:
        return round(100 * self.completed_sp / self.assigned_sp, 1) if self.assigned_sp else 0.0


class SprintBreakdownRow(BaseModel):
    name: str
    state: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    planned_sp: float = 0.0
    completed_sp: float = 0.0
    tasks_total: int = 0
    tasks_done: int = 0

    @property
    def completion_rate(self) -> float:
        return round(100 * self.completed_sp / self.planned_sp, 1) if self.planned_sp else 0.0

    @property
    def spillover_tasks(self) -> int:
        return self.tasks_total - self.tasks_done


class TypeBreakdownRow(BaseModel):
    issue_type: str
    count: int = 0
    sp: float = 0.0
    done: int = 0


class FlowMetrics(BaseModel):
    """Objective delivery-flow timings (no individual scoring)."""

    task_lead_avg_days: float | None = None
    task_lead_median_days: float | None = None
    task_lead_count: int = 0
    task_cycle_avg_days: float | None = None
    task_cycle_median_days: float | None = None
    task_cycle_count: int = 0
    pr_cycle_avg_hours: float | None = None
    pr_cycle_median_hours: float | None = None
    pr_cycle_count: int = 0


class ProjectInfo(BaseModel):
    name: str
    key: str | None = None
    description: str | None = None


class ReportContext(BaseModel):
    title: str
    report_type: str = "sprint"
    scope_label: str | None = None
    generated_at: datetime
    project: ProjectInfo
    sprint: SprintInfo | None = None
    summary: ReportSummary
    members: list[MemberReport] = Field(default_factory=list)
    deliverables: list[DeliverableItem] = Field(default_factory=list)
    data_quality: DataQuality = Field(default_factory=DataQuality)
    flow: FlowMetrics = Field(default_factory=FlowMetrics)
    # project closing-review extras (populated for whole-project scope)
    sprint_breakdown: list[SprintBreakdownRow] = Field(default_factory=list)
    type_breakdown: list[TypeBreakdownRow] = Field(default_factory=list)
    project_start: date | None = None
    project_end: date | None = None
    duration_days: int | None = None
    num_sprints: int = 0
    # scope change: tasks created after project kickoff (first sprint start)
    scope_baseline_sp: float = 0.0
    scope_added_sp: float = 0.0
    scope_added_tasks: int = 0

    @property
    def scope_growth_pct(self) -> float:
        return round(100 * self.scope_added_sp / self.scope_baseline_sp, 1) if self.scope_baseline_sp else 0.0
    # rendered SVG chart markup keyed by name
    charts: dict[str, str] = Field(default_factory=dict)
