"""Reference document API schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ApiModel, JobStatus


class ReferenceFolderOut(ApiModel):
    """One folder, flat. The client assembles the tree from parent_id.

    Sending the flat list rather than a nested structure keeps this a single
    cached collection the UI can re-key locally after a rename or move, the way
    the board reads its tasks flat and TaskTreeView nests them on render.
    """
    id: int
    project_id: int
    parent_id: int | None
    name: str
    created_at: datetime | None = None


class ReferenceFolderCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # NULL = create at the project root.
    parent_id: int | None = None


class ReferenceFolderPatchIn(BaseModel):
    """Rename and/or reparent. Omitted fields are left alone.

    parent_id needs to distinguish "not given" from "move to the root", so the
    sentinel is the field being absent — hence exclude_unset at the call site
    rather than None meaning both things.
    """
    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_id: int | None = None


class ReferenceFilePatchIn(BaseModel):
    """Re-file a document. NULL moves it to the project root."""
    folder_id: int | None = None


class ReferenceFileOut(ApiModel):
    id: int
    project_id: int
    task_id: int | None
    # NULL = filed at the project root, which is where everything uploaded
    # before folders existed still sits.
    folder_id: int | None
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
