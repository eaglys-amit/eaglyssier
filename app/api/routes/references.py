"""Reference document upload, management, and byte serving.

Unlike report artifacts — which live at /reports/... in app.web.routes and
needed their own vite proxy entry — the view/download routes stay under /api
alongside the JSON, so the existing dev proxy covers them.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.config import settings
from app.db import get_db
from app.models import Project, ReferenceFile, Task
from app.schemas.reference import (
    ReferenceFilePatchIn,
    ReferenceFileOut,
    ReferenceFolderCreateIn,
    ReferenceFolderOut,
    ReferenceFolderPatchIn,
    ReferenceUploadOut,
    RejectedFile,
)
from app.services import references as refs
from app.storage import rustfs

router = APIRouter()

# 1 MiB read chunks. Starlette spools an UploadFile to a temp file with no size
# cap of its own, and Content-Length is client-supplied, so the limit has to be
# enforced while reading.
_CHUNK = 1 << 20


def _out(row: ReferenceFile) -> ReferenceFileOut:
    return ReferenceFileOut.model_validate(row).model_copy(
        update={
            "view_url": f"/api/references/{row.id}/view",
            "download_url": f"/api/references/{row.id}/download",
        }
    )


async def _read_capped(upload: UploadFile) -> bytes:
    """Read the upload, aborting past the configured byte cap."""
    limit = settings.reference_max_bytes
    buf = bytearray()
    while chunk := await upload.read(_CHUNK):
        buf.extend(chunk)
        if len(buf) > limit:
            raise refs.ReferenceError(
                413,
                f"{upload.filename} is larger than the "
                f"{limit // 1_000_000} MB limit.",
            )
    return bytes(buf)


@router.post(
    "/projects/{project_id}/references",
    response_model=ReferenceUploadOut,
    status_code=201,
)
async def upload_references(
    project_id: int,
    files: list[UploadFile] = File(...),
    task_id: int | None = Form(None),
    folder_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    """Upload one or more reference documents; text is extracted inline.

    Partial success by design: each file is accepted or rejected on its own, so
    one bad file in a drop doesn't discard the rest.

    ``folder_id`` files the batch straight into a folder — the drop zone sends
    whichever folder is open, so a drop lands where the user is looking rather
    than at the root.
    """
    get_or_404(db, Project, project_id)
    if task_id is not None:
        task = get_or_404(db, Task, task_id, "Task")
        if task.project_id != project_id:
            raise HTTPException(404, "Task not found in this project")
    # Validated once up front: a bad folder is a bad request for the whole
    # batch, not a per-file rejection like an oversized upload.
    if folder_id is not None:
        refs.get_folder_or_404(db, project_id, folder_id)

    uploaded: list[ReferenceFileOut] = []
    rejected: list[RejectedFile] = []
    for upload in files:
        name = upload.filename or "document"
        try:
            data = await _read_capped(upload)
            row = refs.store_reference(
                db,
                project_id,
                filename=name,
                content_type=upload.content_type or "",
                data=data,
                task_id=task_id,
                folder_id=folder_id,
            )
            uploaded.append(_out(row))
        except refs.ReferenceError as exc:
            db.rollback()
            rejected.append(RejectedFile(filename=name, reason=str(exc.detail)))
        except Exception as exc:  # noqa: BLE001 - one file must not fail the batch
            db.rollback()
            rejected.append(RejectedFile(filename=name, reason=str(exc)[:300]))
        finally:
            await upload.close()

    return ReferenceUploadOut(uploaded=uploaded, rejected=rejected)


@router.get("/projects/{project_id}/references", response_model=list[ReferenceFileOut])
def list_references(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    return [_out(r) for r in refs.list_references(db, project_id)]


@router.get("/tasks/{task_id}/references", response_model=list[ReferenceFileOut])
def task_references(task_id: int, db: Session = Depends(get_db)):
    task = get_or_404(db, Task, task_id, "Task")
    return [_out(r) for r in refs.list_references(db, task.project_id, task_id=task_id)]


@router.patch("/references/{file_id}", response_model=ReferenceFileOut)
def move_reference(file_id: int, body: ReferenceFilePatchIn, db: Session = Depends(get_db)):
    """Re-file a document. ``folder_id: null`` moves it to the project root."""
    return _out(refs.move_file(db, file_id, body.folder_id))


# --- folders ----------------------------------------------------------------
#
# Flat in, flat out: the tree is an adjacency list and the client nests it. The
# guards that matter (sibling-name collisions, moving a folder into its own
# subtree) live in the service, since they need the project's whole folder list.


@router.get(
    "/projects/{project_id}/reference-folders", response_model=list[ReferenceFolderOut]
)
def list_reference_folders(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    return refs.list_folders(db, project_id)


@router.post(
    "/projects/{project_id}/reference-folders",
    response_model=ReferenceFolderOut,
    status_code=201,
)
def create_reference_folder(
    project_id: int, body: ReferenceFolderCreateIn, db: Session = Depends(get_db)
):
    get_or_404(db, Project, project_id)
    return refs.create_folder(db, project_id, name=body.name, parent_id=body.parent_id)


@router.patch(
    "/projects/{project_id}/reference-folders/{folder_id}",
    response_model=ReferenceFolderOut,
)
def update_reference_folder(
    project_id: int,
    folder_id: int,
    body: ReferenceFolderPatchIn,
    db: Session = Depends(get_db),
):
    """Rename and/or reparent.

    ``parent_id`` being *absent* means "leave it where it is"; sending it as
    null means "move to the top level". Only the field set explicitly can be
    told apart, hence model_fields_set rather than a None check.
    """
    get_or_404(db, Project, project_id)
    return refs.update_folder(
        db,
        project_id,
        folder_id,
        name=body.name,
        parent_id=body.parent_id,
        reparent="parent_id" in body.model_fields_set,
    )


@router.delete(
    "/projects/{project_id}/reference-folders/{folder_id}", status_code=204
)
def delete_reference_folder(project_id: int, folder_id: int, db: Session = Depends(get_db)):
    """Delete a folder and its subfolders. The documents survive at the root."""
    get_or_404(db, Project, project_id)
    refs.delete_folder(db, project_id, folder_id)


@router.post("/references/{file_id}/extract", response_model=ReferenceFileOut)
def retry_extraction(file_id: int, db: Session = Depends(get_db)):
    """Re-read the stored bytes and try extracting text again."""
    row = refs.re_extract(db, file_id)
    if row is None:
        raise HTTPException(404, "Reference file not found")
    return _out(row)


@router.delete("/references/{file_id}", status_code=204)
def delete_reference(file_id: int, db: Session = Depends(get_db)):
    """Tolerant delete; the stored blob is removed best-effort."""
    refs.delete_reference(db, file_id)


# --- serving the bytes ------------------------------------------------------
#
# Unlike report artifacts (which sit at /reports/... and needed their own vite
# proxy entry) these stay under /api, so the existing dev proxy covers them and
# there is no config to keep in sync.
#
# The bytes are proxied through FastAPI rather than handed out as a presigned
# URL: rustfs.presigned_url() would sign against http://rustfs:9000, a
# Docker-network hostname no browser can resolve.


def _blob(db: Session, file_id: int) -> tuple[ReferenceFile, bytes]:
    row = db.get(ReferenceFile, file_id)
    if row is None or not row.storage_key:
        raise HTTPException(404, "Reference file not found")
    return row, rustfs.get_object(row.storage_key)


@router.get("/references/{file_id}/view")
def view_reference(file_id: int, db: Session = Depends(get_db)):
    """Inline, with the file's own content type."""
    row, data = _blob(db, file_id)
    # Inline HTML from an upload would run in the app's origin, so it is served
    # as plain text instead. Markdown likewise: browsers download it otherwise.
    media_type = row.content_type
    if row.kind in ("html", "md", "txt"):
        media_type = "text/plain; charset=utf-8"
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{refs.safe_filename(row.filename)}"',
            # Belt and braces against the served bytes being treated as markup.
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/references/{file_id}/download")
def download_reference(file_id: int, db: Session = Depends(get_db)):
    row, data = _blob(db, file_id)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{refs.safe_filename(row.filename)}"'
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )
