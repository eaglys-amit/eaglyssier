"""Per-repository documentation sets: the tree, the generation queue, the bytes.

Repo-scoped collections live under ``/repos/{repo_id}/...`` and item routes
under ``/repo-docs/{doc_id}``; folder items keep the repo prefix because the
cycle and name guards need the repo's whole folder list. That is the same split
references.py uses.

Everything stays under ``/api`` so the existing vite dev proxy covers it, and
all bytes are proxied through FastAPI — rustfs.presigned_url() would sign
against http://rustfs:9000, a Docker-network hostname no browser can resolve.
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import run_in_session
from app.db import get_db
from app.models import GitRepo, ReferenceFile, RepoDoc
from app.schemas.repo_doc import (
    DocCancelOut,
    DocQueueOut,
    DocSetGenerateIn,
    DocSetSeedIn,
    RepoDocContentIn,
    RepoDocCreateIn,
    RepoDocDetailOut,
    RepoDocFolderCreateIn,
    RepoDocFolderOut,
    RepoDocFolderPatchIn,
    RepoDocGenerateIn,
    RepoDocOut,
    RepoDocPatchIn,
    RepoDocQueueOut,
    RepoDocSetOut,
    RepoDocSuggestionOut,
    RepoDocSuggestOut,
    RepoDocSummaryOut,
    SuggestAcceptIn,
)
from app.services import references as refs
from app.services import repo_doc_gen as gen
from app.services import repo_docs as docs_svc

router = APIRouter()


# ------------------------------------------------------------------- shaping


def _out(doc: RepoDoc) -> RepoDocOut:
    """URLs and the derived flags are injected here rather than stored.

    Same convention as references._out(): a stored URL would be a second source
    of truth for a path the router already owns.
    """
    return RepoDocOut.model_validate(doc).model_copy(
        update={
            "has_content": bool(doc.storage_key),
            "hand_edited": gen.is_hand_edited(doc),
            "slug": refs.safe_filename(doc.title),
            "download_url": f"/api/repo-docs/{doc.id}/download",
            "view_url": f"/api/repo-docs/{doc.id}/view",
        }
    )


def _detail(db: Session, doc: RepoDoc) -> RepoDocDetailOut:
    names = list(
        db.execute(
            select(ReferenceFile.filename).where(
                ReferenceFile.id.in_(doc.reference_file_ids or [])
            )
        )
        .scalars()
        .all()
    )
    return RepoDocDetailOut.model_validate(
        {
            **_out(doc).model_dump(),
            "markdown": docs_svc.read_markdown(db, doc),
            "reference_filenames": names,
        }
    )


def _queue(docs: list[RepoDoc]) -> RepoDocQueueOut:
    return RepoDocQueueOut(
        total=len(docs),
        queued=sum(1 for d in docs if d.status == "queued"),
        running=sum(1 for d in docs if d.status == "running"),
        failed=sum(1 for d in docs if d.status == "failed"),
        ready=sum(1 for d in docs if d.storage_key),
        missing=sum(1 for d in docs if not d.storage_key),
    )


def _set_out(db: Session, repo: GitRepo) -> RepoDocSetOut:
    folders = docs_svc.list_folders(db, repo.id)
    docs = docs_svc.list_docs(db, repo.id)
    return RepoDocSetOut(
        repo_id=repo.id,
        repo_name=repo.name,
        seeded_at=repo.docs_seeded_at,
        folders=[RepoDocFolderOut.model_validate(f) for f in folders],
        docs=[_out(d) for d in docs],
        queue=_queue(docs),
        suggest_status=repo.doc_suggest_status,
    )


def _suggest_out(repo: GitRepo) -> RepoDocSuggestOut:
    payload = repo.doc_suggestions if isinstance(repo.doc_suggestions, dict) else {}
    return RepoDocSuggestOut(
        repo_id=repo.id,
        status=repo.doc_suggest_status,
        error=repo.doc_suggest_error,
        model=repo.doc_suggest_model,
        suggested_at=repo.doc_suggested_at,
        items=[
            RepoDocSuggestionOut.model_validate(i)
            for i in (payload.get("items") or [])
            if isinstance(i, dict)
        ],
    )


# ---------------------------------------------------------------- the set


@router.get("/repos/{repo_id}/doc-set", response_model=RepoDocSetOut)
def get_doc_set(repo_id: int, db: Session = Depends(get_db)):
    """The whole tree, without any markdown. The queue poll target."""
    return _set_out(db, docs_svc.get_repo_or_404(db, repo_id))


@router.post("/repos/{repo_id}/doc-set/seed", response_model=RepoDocSetOut)
def seed_doc_set(
    repo_id: int, body: DocSetSeedIn | None = None, db: Session = Depends(get_db)
):
    """Create the built-in template, once, and return the whole set.

    A POST rather than seeding inside the GET: a mutating GET breaks retry and
    prefetch semantics, and React Query's prefetch-then-refetch would fire two
    seeds concurrently. Idempotent, hence 200 rather than 201 — the atomic
    claim in seed_doc_set makes the concurrent case safe regardless.
    """
    repo = docs_svc.get_repo_or_404(db, repo_id)
    docs_svc.seed_doc_set(db, repo_id)
    if body is not None and body.restore_missing:
        docs_svc.restore_missing_template(db, repo_id)
    db.refresh(repo)
    return _set_out(db, repo)


@router.get("/projects/{project_id}/repo-docs", response_model=list[RepoDocSummaryOut])
def project_doc_summaries(project_id: int, db: Session = Depends(get_db)):
    """Per-repo rollup for the picker, so it needs no set query per repository."""
    repos = list(
        db.execute(
            select(GitRepo).where(GitRepo.project_id == project_id).order_by(GitRepo.name)
        )
        .scalars()
        .all()
    )
    rows = list(db.execute(select(RepoDoc)).scalars().all()) if repos else []
    by_repo: dict[int, list[RepoDoc]] = {}
    for doc in rows:
        by_repo.setdefault(doc.repo_id, []).append(doc)

    out: list[RepoDocSummaryOut] = []
    for repo in repos:
        docs = by_repo.get(repo.id, [])
        q = _queue(docs)
        out.append(
            RepoDocSummaryOut(
                repo_id=repo.id,
                repo_name=repo.name,
                seeded=repo.docs_seeded_at is not None,
                total=q.total,
                ready=q.ready,
                active=q.queued + q.running,
                failed=q.failed,
                missing=q.missing,
            )
        )
    return out


# ------------------------------------------------------------- one document


@router.get("/repo-docs/{doc_id}", response_model=RepoDocDetailOut)
def get_doc(doc_id: int, db: Session = Depends(get_db)):
    """The document and its markdown. The per-document poll target."""
    return _detail(db, docs_svc.get_doc_or_404(db, doc_id))


@router.put("/repo-docs/{doc_id}/content", response_model=RepoDocDetailOut)
def save_doc_content(
    doc_id: int, body: RepoDocContentIn, db: Session = Depends(get_db)
):
    """Persist a hand edit.

    409 on a stale ``base_rev`` rather than last-write-wins: a generation that
    landed while the pane sat open would otherwise be silently overwritten, and
    the user would never learn their document had been rewritten underneath
    them.
    """
    doc = docs_svc.get_doc_or_404(db, doc_id)
    if doc.status in ("queued", "running"):
        raise HTTPException(409, "This document is being generated — wait for it to finish.")
    if body.base_rev != doc.rev:
        raise HTTPException(
            409,
            "This document changed on the server since you opened it. "
            "Reload to see the new version, then re-apply your edits.",
        )
    docs_svc.save_markdown(db, doc, body.markdown)
    return _detail(db, doc)


@router.patch("/repo-docs/{doc_id}", response_model=RepoDocOut)
def patch_doc(doc_id: int, body: RepoDocPatchIn, db: Session = Depends(get_db)):
    """Rename, re-file, or re-brief a document."""
    # An absent folder_id means "leave it where it is"; an explicit null means
    # "move it to the set root". Only model_fields_set can tell those apart, so
    # it drives `refile` — omit this and "move to root" is a silent no-op.
    return _out(
        docs_svc.update_doc(
            db,
            doc_id,
            title=body.title,
            folder_id=body.folder_id,
            refile="folder_id" in body.model_fields_set,
            guidance=body.guidance,
            instructions=body.instructions,
            reference_file_ids=body.reference_file_ids,
        )
    )


@router.post("/repos/{repo_id}/docs", response_model=RepoDocOut, status_code=201)
def create_doc(repo_id: int, body: RepoDocCreateIn, db: Session = Depends(get_db)):
    docs_svc.get_repo_or_404(db, repo_id)
    return _out(
        docs_svc.create_doc(
            db,
            repo_id,
            title=body.title,
            folder_id=body.folder_id,
            guidance=body.guidance,
            context_kinds=body.context_kinds,
            markdown=body.markdown,
        )
    )


@router.delete("/repo-docs/{doc_id}", status_code=204)
def delete_doc(doc_id: int, db: Session = Depends(get_db)):
    """Tolerant delete; the stored blob is removed best-effort."""
    docs_svc.delete_doc(db, doc_id)


# ----------------------------------------------------------------- folders


@router.post(
    "/repos/{repo_id}/doc-folders", response_model=RepoDocFolderOut, status_code=201
)
def create_folder(
    repo_id: int, body: RepoDocFolderCreateIn, db: Session = Depends(get_db)
):
    docs_svc.get_repo_or_404(db, repo_id)
    return RepoDocFolderOut.model_validate(
        docs_svc.create_folder(db, repo_id, name=body.name, parent_id=body.parent_id)
    )


@router.patch(
    "/repos/{repo_id}/doc-folders/{folder_id}", response_model=RepoDocFolderOut
)
def patch_folder(
    repo_id: int,
    folder_id: int,
    body: RepoDocFolderPatchIn,
    db: Session = Depends(get_db),
):
    """Rename and/or move. 409 on a cycle or a duplicate sibling name."""
    # See patch_doc: absent parent_id != explicit null, and only
    # model_fields_set distinguishes them.
    return RepoDocFolderOut.model_validate(
        docs_svc.update_folder(
            db,
            repo_id,
            folder_id,
            name=body.name,
            parent_id=body.parent_id,
            reparent="parent_id" in body.model_fields_set,
        )
    )


@router.delete("/repos/{repo_id}/doc-folders/{folder_id}", status_code=204)
def delete_folder(repo_id: int, folder_id: int, db: Session = Depends(get_db)):
    """Subfolders go with it; the documents survive at the set root.

    Both rules are the database's — see the RepoDoc model for why they differ.
    """
    docs_svc.delete_folder(db, repo_id, folder_id)


# -------------------------------------------------------------- generation


@router.post("/repo-docs/{doc_id}/generate", response_model=RepoDocOut, status_code=202)
def generate_doc(
    doc_id: int,
    body: RepoDocGenerateIn | None = None,
    background: BackgroundTasks = None,
    db: Session = Depends(get_db),
):
    """Queue one document and kick the repo's drain worker.

    Through the queue rather than straight to generate_doc, so a per-document
    generate cannot race the drain worker into running two model calls for the
    same repository at once.
    """
    doc = docs_svc.get_doc_or_404(db, doc_id)
    if doc.status == "running":
        raise HTTPException(409, "That document is already being generated")
    body = body or RepoDocGenerateIn()
    queued = gen.enqueue_doc(
        db,
        doc_id,
        instructions=body.instructions,
        reference_file_ids=body.reference_file_ids,
    )
    background.add_task(run_in_session, gen.run_doc_worker, doc.repo_id)
    return _out(queued or doc)


@router.post(
    "/repo-docs/{doc_id}/generate/cancel", response_model=RepoDocOut, status_code=202
)
def cancel_doc(doc_id: int, db: Session = Depends(get_db)):
    """Dequeue it, or ask a running generation to stop at its next checkpoint."""
    doc = gen.cancel_doc(db, doc_id)
    if doc is None:
        raise HTTPException(404, "Document not found")
    return _out(doc)


@router.post(
    "/repos/{repo_id}/doc-set/generate", response_model=DocQueueOut, status_code=202
)
def generate_doc_set(
    repo_id: int,
    body: DocSetGenerateIn | None = None,
    background: BackgroundTasks = None,
    db: Session = Depends(get_db),
):
    """Queue the whole set (or one folder's subtree); the worker drains it."""
    docs_svc.get_repo_or_404(db, repo_id)
    body = body or DocSetGenerateIn()
    ids = gen.enqueue_repo_docs(
        db,
        repo_id,
        only_missing=body.only_missing,
        folder_id=body.folder_id,
        instructions=body.instructions,
        reference_file_ids=body.reference_file_ids,
        skip_hand_edited=body.skip_hand_edited,
    )
    if ids:
        background.add_task(run_in_session, gen.run_doc_worker, repo_id)
    return DocQueueOut(queued=len(ids), doc_ids=ids)


@router.post(
    "/repos/{repo_id}/doc-set/generate/cancel",
    response_model=DocCancelOut,
    status_code=202,
)
def cancel_doc_set(repo_id: int, db: Session = Depends(get_db)):
    docs_svc.get_repo_or_404(db, repo_id)
    return DocCancelOut(cancelled=gen.cancel_repo_docs(db, repo_id))


# ------------------------------------------------------------- suggestions


@router.post(
    "/repos/{repo_id}/doc-set/suggest", response_model=RepoDocSuggestOut, status_code=202
)
def suggest_docs(
    repo_id: int, background: BackgroundTasks, db: Session = Depends(get_db)
):
    """Ask the model what else this repository needs documented."""
    repo = docs_svc.get_repo_or_404(db, repo_id)
    if repo.doc_suggest_status == "running":
        raise HTTPException(409, "Suggestions are already being generated")
    repo.doc_suggest_status = "running"
    repo.doc_suggest_error = None
    db.commit()
    db.refresh(repo)
    background.add_task(run_in_session, gen.suggest_docs, repo_id)
    return _suggest_out(repo)


@router.get(
    "/repos/{repo_id}/doc-set/suggestions", response_model=RepoDocSuggestOut
)
def get_suggestions(repo_id: int, db: Session = Depends(get_db)):
    """The staged proposal. The suggestion poll target."""
    return _suggest_out(docs_svc.get_repo_or_404(db, repo_id))


@router.post(
    "/repos/{repo_id}/doc-set/suggestions/accept",
    response_model=RepoDocSetOut,
    status_code=201,
)
def accept_suggestions(
    repo_id: int, body: SuggestAcceptIn, db: Session = Depends(get_db)
):
    """Create the ticked proposals. Synchronous — no model call, so 201."""
    repo = docs_svc.get_repo_or_404(db, repo_id)
    if repo.doc_suggest_status != "ready":
        raise HTTPException(409, "There is no proposal to accept")
    gen.accept_suggestions(db, repo_id, body.refs)
    db.refresh(repo)
    return _set_out(db, repo)


@router.delete("/repos/{repo_id}/doc-set/suggestions", status_code=204)
def dismiss_suggestions(repo_id: int, db: Session = Depends(get_db)):
    gen.dismiss_suggestions(db, repo_id)


# ---------------------------------------------------------- serving the bytes


def _blob(db: Session, doc_id: int) -> tuple[RepoDoc, bytes]:
    doc = docs_svc.get_doc_or_404(db, doc_id)
    if not doc.storage_key:
        raise HTTPException(404, "This document has not been generated yet")
    return doc, docs_svc.read_markdown(db, doc).encode("utf-8")


@router.get("/repo-docs/{doc_id}/view")
def view_doc(doc_id: int, db: Session = Depends(get_db)):
    """Inline, as plain text.

    Markdown is served as text/plain for the reason references.view_reference
    gives: browsers download it otherwise, and nosniff keeps the bytes from
    being treated as markup.
    """
    doc, data = _blob(db, doc_id)
    return Response(
        content=data,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="{refs.safe_filename(doc.title)}.md"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/repo-docs/{doc_id}/download")
def download_doc(doc_id: int, db: Session = Depends(get_db)):
    doc, data = _blob(db, doc_id)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{refs.safe_filename(doc.title)}.md"'
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/repos/{repo_id}/doc-set/archive")
def download_archive(repo_id: int, db: Session = Depends(get_db)):
    """The whole set as a .zip, laid out like the folder tree."""
    docs_svc.get_repo_or_404(db, repo_id)
    if not docs_svc.list_docs(db, repo_id):
        raise HTTPException(404, "This documentation set is empty — nothing to archive.")
    filename, blob = docs_svc.build_archive(db, repo_id)
    return Response(
        content=blob,
        media_type="application/zip",
        headers={
            # safe_filename keeps the header ASCII-safe, which matters for repo
            # names with non-Latin characters.
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
