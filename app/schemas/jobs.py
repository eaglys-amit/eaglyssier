"""Status payloads for LLM/background jobs (polled by the SPA while running)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ApiModel, JobStatus


class CommitAnalysisOut(BaseModel):
    commit_id: int
    status: JobStatus
    analysis: dict | None
    error: str | None
    model: str | None
    analyzed_at: datetime | None


class RepoSummaryOut(BaseModel):
    repo_id: int
    status: JobStatus
    summary: dict | None
    error: str | None
    model: str | None
    summarized_at: datetime | None


class RepoSyncOut(BaseModel):
    id: int
    sync_status: JobStatus
    sync_error: str | None
    synced_at: datetime | None


class RepoSyncIn(BaseModel):
    """Sync one repo picked on the Integrations page but not yet pulled."""

    provider: str
    full_name: str


class AnalyzeAllOut(BaseModel):
    queued: int
    commit_ids: list[int]


class KpiOut(BaseModel):
    member_id: int
    display_name: str
    status: JobStatus
    kpi: dict | None
    error: str | None
    model: str | None
    generated_at: datetime | None


class KpiGenerateIn(BaseModel):
    member_ids: list[int] = []


class DeliverableOut(ApiModel):
    id: int
    name: str
    description: str | None
    status: str
    linked_task_keys: list
    source: str
    sprint_id: int | None


class DeliverablesOut(BaseModel):
    status: JobStatus
    error: str | None
    model: str | None
    generated_at: datetime | None
    items: list[DeliverableOut]
