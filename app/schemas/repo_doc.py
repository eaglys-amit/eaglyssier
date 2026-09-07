"""Per-repository documentation set API schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ApiModel, JobStatus

DocSource = Literal["template", "ai", "manual"]


class RepoDocFolderOut(ApiModel):
    """One folder, flat. The client assembles the tree from parent_id.

    Flat rather than nested for the reason spelled out on ReferenceFolderOut:
    it stays a single cached collection the UI can re-key locally after a
    rename or move.
    """
    id: int
    repo_id: int
    parent_id: int | None
    name: str
    rank: int
    source: DocSource
    template_key: str | None = None
    created_at: datetime | None = None


class RepoDocOut(ApiModel):
    """A document WITHOUT its markdown.

    The set listing is polled every 2s while a queue drains, so the body is
    deliberately not here — shipping eleven documents' markdown on every tick
    would be pure waste. RepoDocDetailOut carries it for the one open document.
    """
    id: int
    repo_id: int
    folder_id: int | None
    title: str
    rank: int
    source: DocSource
    template_key: str | None = None
    guidance: str | None = None
    context_kinds: list[str] = []
    instructions: str | None = None
    reference_file_ids: list[int] = []
    status: JobStatus
    error: str | None = None
    model: str | None = None
    summary: str | None = None
    char_count: int
    rev: int
    generated_at: datetime | None = None
    edited_at: datetime | None = None
    updated_at: datetime | None = None

    # Injected by the route, not stored.
    has_content: bool = False
    hand_edited: bool = False
    slug: str = ""
    download_url: str | None = None
    view_url: str | None = None


class RepoDocDetailOut(RepoDocOut):
    """One document with its markdown — the preview's and editor's source."""
    markdown: str = ""
    reference_filenames: list[str] = []


class RepoDocQueueOut(BaseModel):
    total: int
    queued: int
    running: int
    failed: int
    ready: int
    missing: int


class RepoDocSetOut(BaseModel):
    repo_id: int
    repo_name: str
    seeded_at: datetime | None = None
    folders: list[RepoDocFolderOut]
    docs: list[RepoDocOut]
    queue: RepoDocQueueOut
    suggest_status: JobStatus = "none"


class DocSetSeedIn(BaseModel):
    """Seeding is idempotent. ``restore_missing`` re-creates deleted template
    rows, which is a button the user presses rather than something the plain
    seed does behind their back."""
    restore_missing: bool = False


class RepoDocFolderCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # NULL = create at the root of the set.
    parent_id: int | None = None


class RepoDocFolderPatchIn(BaseModel):
    """Rename and/or reparent. Omitted fields are left alone.

    parent_id must distinguish "not given" from "move to the root", so the
    sentinel is the field being absent — hence model_fields_set at the call
    site rather than None meaning both things.
    """
    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_id: int | None = None


class RepoDocCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=512)
    folder_id: int | None = None
    guidance: str | None = None
    context_kinds: list[str] = []
    markdown: str | None = None


class RepoDocPatchIn(BaseModel):
    """Rename, re-file and/or re-brief. Omitted fields are left alone.

    folder_id carries the same absent-vs-null distinction as parent_id above.
    """
    title: str | None = Field(default=None, min_length=1, max_length=512)
    folder_id: int | None = None
    guidance: str | None = None
    instructions: str | None = None
    reference_file_ids: list[int] | None = None


class RepoDocContentIn(BaseModel):
    """A hand-edited save.

    ``base_rev`` is the rev the editor seeded from. The server rejects a save
    whose base is stale, so an edit cannot silently overwrite a generation that
    landed while the pane sat open.
    """
    markdown: str
    base_rev: int


class RepoDocGenerateIn(BaseModel):
    instructions: str | None = None
    reference_file_ids: list[int] | None = None


class DocSetGenerateIn(RepoDocGenerateIn):
    """``only_missing`` is the scope a user almost always wants: filling in the
    blanks without regenerating the documents that are already good."""
    only_missing: bool = False
    folder_id: int | None = None
    skip_hand_edited: bool = True


class DocQueueOut(BaseModel):
    queued: int
    doc_ids: list[int] = []


class DocCancelOut(BaseModel):
    cancelled: int


class RepoDocSuggestionOut(BaseModel):
    """One proposed folder or document.

    ``existing`` is the server saying this is already in the set, so the review
    UI seeds the row unchecked instead of quietly growing a duplicate.
    """
    kind: Literal["folder", "doc"]
    ref: str
    path: str
    title: str | None = None
    name: str | None = None
    parent_ref: str | None = None
    parent_folder_id: int | None = None
    guidance: str | None = None
    context_kinds: list[str] = []
    rationale: str | None = None
    existing: bool = False


class RepoDocSuggestOut(BaseModel):
    repo_id: int
    status: JobStatus
    error: str | None = None
    model: str | None = None
    suggested_at: datetime | None = None
    items: list[RepoDocSuggestionOut] = []


class SuggestAcceptIn(BaseModel):
    """The refs the user ticked. A ticked document pulls in the folder it needs."""
    refs: list[str] = []


class RepoDocSummaryOut(BaseModel):
    """Per-repo rollup for the picker, so it needs no set query per repository."""
    repo_id: int
    repo_name: str
    seeded: bool
    total: int
    ready: int
    active: int
    failed: int
    missing: int
