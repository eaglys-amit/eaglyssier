"""Reference document API schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ApiModel, JobStatus


class ReferenceFileOut(ApiModel):
    id: int
    project_id: int
    task_id: int | None
    filename: str
    content_type: str
    size_bytes: int
    kind: str  # md | txt | html | pdf
    extract_status: JobStatus
    extract_error: str | None
    # 0 with extract_status='ready' means the file held no extractable text —
    # a scanned PDF, typically. Not an error, but it can't inform a prompt.
    char_count: int
    created_at: datetime | None = None
    # Built the way _report_out builds html_url/pdf_url. Served under /api/ so
    # the existing dev proxy covers them with no vite config change.
    view_url: str | None = None
    download_url: str | None = None


class ReferenceUploadOut(BaseModel):
    """Result of a multi-file upload.

    Partial success is the norm — one oversized file in a drop of five
    shouldn't discard the other four — so rejections come back alongside the
    successes rather than as an error status.
    """
    uploaded: list[ReferenceFileOut] = []
    rejected: list[RejectedFile] = []


class RejectedFile(BaseModel):
    filename: str
    reason: str


ReferenceUploadOut.model_rebuild()
