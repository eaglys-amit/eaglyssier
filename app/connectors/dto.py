"""Normalized data-transfer objects produced by connectors and consumed by sync.

Connectors translate each source's API shape into these provider-agnostic objects
so the sync service has one code path regardless of Jira/GitHub/GitLab specifics.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class IdentityDTO:
    external_id: str
    username: str | None = None
    email: str | None = None
    display_name: str | None = None


@dataclass
class SprintDTO:
    external_id: str
    name: str
    state: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    complete_date: date | None = None
    goal: str | None = None


@dataclass
class TaskDTO:
    external_key: str
    title: str
    description: str | None = None
    issue_type: str | None = None
    status: str | None = None
    status_category: str = "todo"  # todo|in_progress|done
    story_points: float | None = None
    worklog_seconds: int = 0
    reopened_count: int = 0
    sprint_external_id: str | None = None
    assignee: IdentityDTO | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    started_at: datetime | None = None  # first transition into an in-progress status
    resolved_at: datetime | None = None


@dataclass
class RepoDTO:
    external_id: str
    name: str
    url: str | None = None


@dataclass
class CommitDTO:
    sha: str
    author: IdentityDTO | None = None
    authored_at: datetime | None = None
    additions: int = 0
    deletions: int = 0
    files_changed: int = 0
    message: str | None = None
    is_merge: bool = False  # 2+ parents: PR merges / branch updates, not authored work


@dataclass
class CommitFileDTO:
    path: str
    status: str | None = None  # added|modified|removed|renamed
    additions: int = 0
    deletions: int = 0
    patch: str | None = None  # unified diff hunk for this file


@dataclass
class CommitDiffDTO:
    sha: str
    files: list[CommitFileDTO] = field(default_factory=list)
    truncated: bool = False  # set when the diff was capped before analysis


@dataclass
class ReviewDTO:
    external_id: str
    reviewer: IdentityDTO | None = None
    state: str | None = None
    submitted_at: datetime | None = None


@dataclass
class PullRequestDTO:
    external_id: str
    title: str | None = None
    state: str | None = None
    author: IdentityDTO | None = None
    additions: int = 0
    deletions: int = 0
    changed_files: int = 0
    created_at: datetime | None = None
    merged_at: datetime | None = None
    reviews: list[ReviewDTO] = field(default_factory=list)
