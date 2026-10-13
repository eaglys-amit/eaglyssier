"""Specs, requirements and their task links."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RequirementKind = Literal["functional", "non_functional", "user_story", "constraint"]
Priority = Literal["must", "should", "could"]
# Derived from linked tasks (app.services.specs.requirement_status).
RequirementStatus = Literal[
    "untraced", "planned", "in_progress", "implemented", "verified", "removed"
]


class Coverage(BaseModel):
    """Counts over a spec's live (not removed) requirements."""
    total: int = 0
    linked: int = 0        # at least one task
    implemented: int = 0   # every linked task done (includes verified)
    verified: int = 0      # implemented and every acceptance criterion verified
    changed: int = 0       # added or changed in the latest version
    needs_review: int = 0  # requirements with a link flagged for review


class AcceptanceCriterion(BaseModel):
    text: str
    verified: bool = False
    verified_by: str | None = None
    verified_at: datetime | None = None


class LinkedTask(BaseModel):
    task_id: int
    key: str
    title: str
    status: str | None
    status_category: str
    origin: str
    needs_review: bool


class RequirementOut(BaseModel):
    id: int
    key: str
    key_origin: str
    title: str
    statement: str
    kind: str
    priority: str | None
    acceptance_criteria: list[AcceptanceCriterion]
    source_excerpt: str | None
    change_state: str
    changed_in_version: int | None
    status: RequirementStatus
    tasks: list[LinkedTask]


class SpecRevisionOut(BaseModel):
    version: int
    created_at: datetime
    changes: dict


class RepoTaskOut(BaseModel):
    """One tasks.md line and the tracker task it matched (match only)."""
    key: str
    text: str
    done: bool
    story: str | None = None
    parallel: bool = False
    requirement_keys: list[str] = []
    task_id: int | None = None
    match: str | None = None  # key | title
    task_key: str | None = None
    task_title: str | None = None
    task_status_category: str | None = None


class SpecSource(BaseModel):
    """A repository that can feed specs, and its spec sync state."""
    repo_id: int
    name: str
    url: str | None
    provider: str
    spec_sync_enabled: bool
    spec_path: str
    default_branch: str | None
    spec_sync_status: str
    spec_sync_error: str | None
    spec_synced_at: datetime | None
    spec_count: int


class SpecSourceIn(BaseModel):
    enabled: bool
    spec_path: str = "specs/"


class SpecSummary(BaseModel):
    id: int
    title: str
    source: str
    status: str
    version: int
    extract_status: str
    extract_error: str | None
    extract_model: str | None
    reference_file_id: int | None
    filename: str | None
    # A new version is uploaded and waiting for (or failed) extraction.
    has_pending_version: bool
    coverage: Coverage
    updated_at: datetime
    # source="repo"
    repo_id: int | None = None
    repo_name: str | None = None
    path: str | None = None
    ref: str | None = None
    missing_in_repo: bool = False


class SpecDetail(SpecSummary):
    requirements: list[RequirementOut]
    revisions: list[SpecRevisionOut]
    repo_url: str | None = None
    plan_markdown: str | None = None
    repo_tasks: list[RepoTaskOut] = []


class TaskRequirement(BaseModel):
    """A requirement a task implements, as the task sheet lists it."""
    requirement_id: int
    spec_id: int
    spec_title: str
    key: str
    title: str
    status: RequirementStatus
    needs_review: bool
    origin: str


class RequirementBrief(BaseModel):
    """A pickable requirement (task sheet's "link to requirement")."""
    id: int
    key: str
    title: str
    spec_id: int
    spec_title: str
    change_state: str


class ReviewItem(BaseModel):
    """A task link waiting for someone to confirm the task still fits the requirement."""
    requirement_id: int
    spec_id: int
    spec_title: str
    key: str
    title: str
    statement: str
    change_state: str
    changed_in_version: int | None
    task_id: int
    task_key: str
    task_title: str
    task_status_category: str


class ScanResult(BaseModel):
    linked: int
    removed: int
    ambiguous_keys: int


class SpecCreateIn(BaseModel):
    reference_file_id: int
    title: str | None = None


class SpecPatchIn(BaseModel):
    title: str | None = None
    status: Literal["draft", "approved"] | None = None


class RequirementIn(BaseModel):
    key: str | None = None
    title: str = Field(min_length=1, max_length=512)
    statement: str = ""
    kind: RequirementKind = "functional"
    priority: Priority | None = None
    acceptance_criteria: list[str] = []


class RequirementPatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    statement: str | None = None
    kind: RequirementKind | None = None
    priority: Priority | None = None
    clear_priority: bool = False
    # Replaces the list; verification marks survive on criteria whose text is unchanged.
    acceptance_criteria: list[str] | None = None


class RequirementLinkIn(BaseModel):
    task_id: int
