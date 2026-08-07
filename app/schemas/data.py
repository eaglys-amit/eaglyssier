"""Sprint / task / repo / commit / PR read schemas for the Data tab."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.common import ApiModel, JobStatus


class SprintOut(ApiModel):
    id: int
    name: str
    state: str | None
    start_date: date | None
    end_date: date | None
    goal: str | None
    source: str = "sync"  # 'sync' (connector-owned) | 'local' (Scrums tab)
    committed_points: float | None = None
    task_count: int = 0


class TaskOut(ApiModel):
    id: int
    # NULL for locally-created tasks; render app.services.tasks.task_label.
    external_key: str | None
    title: str
    issue_type: str | None
    status: str | None
    status_category: str
    story_points: float | None
    sprint_id: int | None
    source: str = "sync"  # 'sync' | 'local'
    parent_id: int | None = None
    rank: int = 0
    priority: str | None = None
    assignee_name: str | None = None
    assignee_member_id: int | None = None


class TaskCommit(BaseModel):
    """A commit attributed to a task, shown in the task detail sheet."""
    id: int
    sha: str
    authored_at: datetime | None
    summary: str | None
    author_name: str | None


class TaskDetail(BaseModel):
    id: int
    # Display handle from task_label() — the Jira key, or '#<id>' when local.
    # Optional so a caller passing the raw column can't 500 the endpoint.
    key: str | None
    title: str
    description: str | None
    acceptance_criteria: str | None = None
    issue_type: str | None
    status: str | None
    status_category: str
    story_points: float | None
    priority: str | None = None
    source: str = "sync"
    parent_id: int | None = None
    parent_key: str | None = None
    assignee_member_id: int | None = None
    hours: float
    assignee: str | None
    sprint: str | None
    commits: list[TaskCommit] = []


class RepoOut(ApiModel):
    id: int
    provider: str
    name: str
    url: str | None
    sync_status: JobStatus
    sync_error: str | None
    synced_at: datetime | None
    summary_status: JobStatus
    commit_count: int = 0
    pr_count: int = 0


class CommitOut(ApiModel):
    id: int
    sha: str
    message: str | None
    authored_at: datetime | None
    additions: int
    deletions: int
    files_changed: int
    is_merge: bool = False
    author_name: str | None = None
    author_member_id: int | None = None
    analysis_status: JobStatus


class GanttCommit(BaseModel):
    """A commit: a marker on a task bar, or a row in the unassigned list."""
    id: int
    sha: str
    authored_at: datetime | None
    summary: str | None  # LLM analysis summary, falls back to first message line
    additions: int
    deletions: int
    author_name: str | None = None
    repo_name: str | None = None
    link_status: JobStatus = "none"  # attribution job state (unassigned list)


class GanttItem(BaseModel):
    """A Jira task bar on the timeline with its attributed commits."""
    id: str  # "task-<id>"; unique within the payload
    kind: str  # "jira"
    task_id: int | None  # DB Task id (drives the TaskSheet link)
    key: str | None  # task_label(): Jira key, or '#<id>' when local
    parent_id: int | None = None  # breakdown parent, so the UI can nest later
    title: str
    status_category: str | None
    start: datetime
    end: datetime
    story_points: float | None
    commits: list[GanttCommit] = []


class GanttRow(BaseModel):
    """One swimlane, keyed by member (member_id null == Unassigned)."""
    member_id: int | None
    display_name: str
    items: list[GanttItem] = []


class GanttSprint(BaseModel):
    """A sprint's window, drawn as a band/boundary lines on the timeline."""
    id: int
    name: str
    state: str | None
    start: datetime
    end: datetime


class GanttOut(BaseModel):
    rows: list[GanttRow] = []
    sprints: list[GanttSprint] = []
    # Commits not (yet) attributed to any Jira task — the "Analyze" work list.
    unassigned: list[GanttCommit] = []
    range_start: datetime | None
    range_end: datetime | None


class CommitLinkOut(BaseModel):
    """Result of an attribution run for one commit."""
    commit_id: int
    link_status: JobStatus
    linked_task_id: int | None
    link_reason: str | None
    error: str | None


class CommitCandidateTask(BaseModel):
    """A task the user can manually attach a commit to (any of the member's tasks)."""
    id: int
    key: str | None  # task_label(): Jira key, or '#<id>' when local
    title: str
    status_category: str
    assignee_name: str | None
    sprint_name: str | None


class CommitDetail(BaseModel):
    """Full commit view for the commit sheet, with manual-attach candidates."""
    id: int
    sha: str
    message: str | None
    authored_at: datetime | None
    additions: int
    deletions: int
    files_changed: int
    author_name: str | None
    summary: str | None
    analysis: dict | None
    link_status: JobStatus
    linked_task_id: int | None
    link_reason: str | None
    sprint_name: str | None
    candidates: list[CommitCandidateTask] = []


class CommitAttachIn(BaseModel):
    task_id: int


class PRReviewOut(BaseModel):
    state: str | None
    reviewer_name: str | None
    submitted_at: datetime | None


class PullRequestOut(ApiModel):
    id: int
    external_id: str
    title: str | None
    state: str | None
    additions: int
    deletions: int
    changed_files: int
    created_at_src: datetime | None
    merged_at_src: datetime | None
    author_name: str | None = None
    author_member_id: int | None = None
    reviews: list[PRReviewOut] = []
