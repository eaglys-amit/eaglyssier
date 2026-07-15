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
    task_count: int = 0


class TaskOut(ApiModel):
    id: int
    external_key: str
    title: str
    issue_type: str | None
    status: str | None
    status_category: str
    story_points: float | None
    sprint_id: int | None
    assignee_name: str | None = None


class TaskDetail(BaseModel):
    id: int
    key: str
    title: str
    description: str | None
    issue_type: str | None
    status: str | None
    status_category: str
    story_points: float | None
    hours: float
    assignee: str | None
    sprint: str | None


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
    author_name: str | None = None
    analysis_status: JobStatus


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
    reviews: list[PRReviewOut] = []
