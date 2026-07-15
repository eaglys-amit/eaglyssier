"""Project API schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ApiModel, JobStatus


class AnalysisProviderOut(BaseModel):
    key: str
    label: str
    available: bool


class ProjectListItem(ApiModel):
    id: int
    name: str
    key: str | None
    description: str | None
    task_count: int = 0


class ProjectDetail(ApiModel):
    id: int
    name: str
    key: str | None
    description: str | None
    analysis_provider: str
    analysis_model: str | None
    deliverables_status: JobStatus
    deliverables_error: str | None
    deliverables_model: str | None
    deliverables_generated_at: datetime | None
    analysis_providers: list[AnalysisProviderOut] = []
    claude_models: list[str] = []


class ProjectCreate(BaseModel):
    name: str
    key: str | None = None
    description: str | None = None


class ProjectPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    analysis_provider: str | None = None
    # "" clears the override back to the provider default.
    analysis_model: str | None = None
