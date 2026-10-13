"""Specs and requirements: create from documents, versions, edits, task links."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_or_404, run_in_session
from app.api.routes.references import _read_capped
from app.db import get_db
from sqlalchemy import func, select

from app.models import GitRepo, Project, Spec, Task
from app.schemas.spec import (
    RequirementBrief,
    RequirementIn,
    RequirementLinkIn,
    CriterionIn,
    RequirementPatchIn,
    ReviewItem,
    ScanResult,
    SpecCreateIn,
    SpecDetail,
    SpecPatchIn,
    SpecSource,
    SpecSourceIn,
    SpecSummary,
    TaskRequirement,
    UntracedTask,
)
from app.services import references as refs
from app.services import repo_specs
from app.api.authz import Access, get_access
from app.services import spec_verify
from app.services import specs as specs_svc

router = APIRouter()


def _start_extraction(db: Session, spec, background: BackgroundTasks) -> None:
    if not specs_svc.claim_extraction(db, spec):
        raise HTTPException(409, "Requirements are already being extracted; wait for it to finish.")
    background.add_task(run_in_session, specs_svc.extract_document_spec, spec.id)


@router.get("/projects/{project_id}/specs", response_model=list[SpecSummary])
def list_specs(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    return specs_svc.list_specs(db, project_id)


@router.get("/projects/{project_id}/requirements", response_model=list[RequirementBrief])
def list_requirements(project_id: int, db: Session = Depends(get_db)):
    """Every live requirement in the project, for pickers."""
    get_or_404(db, Project, project_id)
    return specs_svc.project_requirements(db, project_id)


@router.get("/projects/{project_id}/specs/untraced", response_model=list[UntracedTask])
def untraced(project_id: int, db: Session = Depends(get_db)):
    """Recent tasks that implement no tracked requirement."""
    get_or_404(db, Project, project_id)
    return spec_verify.untraced_work(db, project_id)


@router.put("/requirements/{requirement_id}/criteria/{index}", status_code=204)
def set_criterion(
    requirement_id: int, index: int, body: CriterionIn,
    db: Session = Depends(get_db), access: Access = Depends(get_access),
):
    """Tick (or untick) one acceptance criterion as verified."""
    req = specs_svc.get_requirement_or_404(db, requirement_id)
    spec_verify.set_criterion(db, req, index, body.text, body.verified, access.user)


@router.post("/requirements/{requirement_id}/ai-check", status_code=202)
def ai_check(requirement_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Ask the AI provider whether the linked work shows each criterion delivered."""
    req = specs_svc.get_requirement_or_404(db, requirement_id)
    if not req.task_links:
        raise HTTPException(400, "Link the tasks that implement this requirement first.")
    if not spec_verify.claim_ai_check(db, req):
        raise HTTPException(409, "A check is already running for this requirement.")
    background.add_task(run_in_session, spec_verify.run_ai_check, req.id)
    return {"status": "running"}


@router.get("/projects/{project_id}/specs/review", response_model=list[ReviewItem])
def review_queue(project_id: int, db: Session = Depends(get_db)):
    """Task links whose requirement changed since they were made."""
    get_or_404(db, Project, project_id)
    return specs_svc.review_queue(db, project_id)


@router.post("/projects/{project_id}/specs/scan-references", response_model=ScanResult)
def scan_references(project_id: int, db: Session = Depends(get_db)):
    """Link tasks that cite a requirement key (FR-001) in their text."""
    get_or_404(db, Project, project_id)
    result = specs_svc.scan_task_references(db, project_id)
    db.commit()
    return result


@router.post("/projects/{project_id}/specs", response_model=SpecDetail, status_code=202)
def create_spec(
    project_id: int, body: SpecCreateIn, background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Track a reference document as a spec; its requirements are extracted in the background."""
    get_or_404(db, Project, project_id)
    spec = specs_svc.create_document_spec(db, project_id, body.reference_file_id, body.title)
    _start_extraction(db, spec, background)
    return specs_svc.spec_detail(db, spec.id)


@router.get("/specs/{spec_id}", response_model=SpecDetail)
def get_spec(spec_id: int, db: Session = Depends(get_db)):
    return specs_svc.spec_detail(db, spec_id)


@router.patch("/specs/{spec_id}", response_model=SpecDetail)
def patch_spec(spec_id: int, body: SpecPatchIn, db: Session = Depends(get_db)):
    spec = specs_svc.get_spec_or_404(db, spec_id)
    if body.title is not None and body.title.strip():
        spec.title = body.title.strip()[:512]
    if body.status is not None:
        spec.status = body.status
    db.commit()
    return specs_svc.spec_detail(db, spec_id)


@router.delete("/specs/{spec_id}", status_code=204)
def delete_spec(spec_id: int, db: Session = Depends(get_db)):
    """Stop tracking it. The documents themselves stay in Documents."""
    spec = specs_svc.get_spec_or_404(db, spec_id)
    db.delete(spec)
    db.commit()


@router.post("/specs/{spec_id}/extract", response_model=SpecDetail, status_code=202)
def re_extract(spec_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Retry a failed extraction (or re-read the current file)."""
    spec = specs_svc.get_spec_or_404(db, spec_id)
    if spec.source != "document":
        raise HTTPException(409, "Repository specs are re-read by syncing them.")
    _start_extraction(db, spec, background)
    return specs_svc.spec_detail(db, spec_id)


@router.post("/specs/{spec_id}/versions", response_model=SpecDetail, status_code=202)
async def upload_version(
    spec_id: int, background: BackgroundTasks, file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload the revised document; it becomes the next version once extracted."""
    spec = specs_svc.get_spec_or_404(db, spec_id)
    if spec.source != "document":
        await file.close()
        raise HTTPException(409, "This spec is synced from its repository; change it there.")
    current = spec.reference_file
    try:
        data = await _read_capped(file)
        row = refs.store_reference(
            db, spec.project_id, filename=file.filename or "document",
            content_type=file.content_type or "", data=data,
            folder_id=current.folder_id if current else None,
        )
    except refs.ReferenceError as exc:
        db.rollback()
        raise HTTPException(400, str(exc.detail)) from exc
    finally:
        await file.close()
    specs_svc.stage_new_version(db, spec, row)
    _start_extraction(db, spec, background)
    return specs_svc.spec_detail(db, spec_id)


@router.post("/specs/{spec_id}/requirements", response_model=SpecDetail, status_code=201)
def add_requirement(spec_id: int, body: RequirementIn, db: Session = Depends(get_db)):
    spec = specs_svc.get_spec_or_404(db, spec_id)
    specs_svc.add_requirement(db, spec, body)
    return specs_svc.spec_detail(db, spec_id)


@router.patch("/requirements/{requirement_id}", status_code=204)
def patch_requirement(
    requirement_id: int, body: RequirementPatchIn, db: Session = Depends(get_db)
):
    specs_svc.patch_requirement(db, specs_svc.get_requirement_or_404(db, requirement_id), body)


@router.delete("/requirements/{requirement_id}", status_code=204)
def delete_requirement(requirement_id: int, db: Session = Depends(get_db)):
    specs_svc.delete_requirement(db, specs_svc.get_requirement_or_404(db, requirement_id))


@router.post("/requirements/{requirement_id}/tasks", status_code=204)
def link_task(requirement_id: int, body: RequirementLinkIn, db: Session = Depends(get_db)):
    req = specs_svc.get_requirement_or_404(db, requirement_id)
    specs_svc.link_task(db, req, body.task_id)


@router.delete("/requirements/{requirement_id}/tasks/{task_id}", status_code=204)
def unlink_task(requirement_id: int, task_id: int, db: Session = Depends(get_db)):
    specs_svc.unlink_task(db, specs_svc.get_requirement_or_404(db, requirement_id), task_id)


@router.post("/requirements/{requirement_id}/tasks/{task_id}/reviewed", status_code=204)
def mark_reviewed(requirement_id: int, task_id: int, db: Session = Depends(get_db)):
    """The task still matches the changed requirement: clear the review flag."""
    specs_svc.mark_reviewed(db, specs_svc.get_requirement_or_404(db, requirement_id), task_id)


@router.get("/tasks/{task_id}/requirements", response_model=list[TaskRequirement])
def task_requirements(task_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Task, task_id, "Task")
    return specs_svc.task_requirements(db, task_id)


# ------------------------------------------------------------ repository specs


def _source(repo: GitRepo, spec_count: int) -> SpecSource:
    return SpecSource(
        repo_id=repo.id, name=repo.name, url=repo.url, provider=repo.provider.value,
        spec_sync_enabled=repo.spec_sync_enabled, spec_path=repo.spec_path,
        default_branch=repo.default_branch, spec_sync_status=repo.spec_sync_status,
        spec_sync_error=repo.spec_sync_error, spec_synced_at=repo.spec_synced_at,
        spec_count=spec_count,
    )


@router.get("/projects/{project_id}/spec-sources", response_model=list[SpecSource])
def spec_sources(project_id: int, db: Session = Depends(get_db)):
    """The project's repositories and whether each feeds specs."""
    get_or_404(db, Project, project_id)
    counts = dict(db.execute(
        select(Spec.repo_id, func.count(Spec.id))
        .where(Spec.project_id == project_id, Spec.repo_id.is_not(None))
        .group_by(Spec.repo_id)
    ).all())
    repos = db.execute(
        select(GitRepo).where(GitRepo.project_id == project_id).order_by(GitRepo.name)
    ).scalars().all()
    return [_source(r, counts.get(r.id, 0)) for r in repos]


def _start_spec_sync(db: Session, repo: GitRepo, background: BackgroundTasks) -> None:
    if not repo_specs.claim(db, repo):
        raise HTTPException(409, "Specs are already syncing for this repository.")
    background.add_task(run_in_session, repo_specs.sync_repo_specs, repo.id)


@router.put("/repos/{repo_id}/spec-source", response_model=SpecSource)
def set_spec_source(
    repo_id: int, body: SpecSourceIn, background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Turn spec sync on (and sync now) or off. Off keeps the specs already read."""
    repo = get_or_404(db, GitRepo, repo_id, "Repository")
    repo.spec_sync_enabled = body.enabled
    repo.spec_path = repo_specs.normalize_spec_path(body.spec_path)
    db.commit()
    if body.enabled:
        _start_spec_sync(db, repo, background)
    count = db.execute(select(func.count(Spec.id)).where(Spec.repo_id == repo.id)).scalar_one()
    return _source(repo, count)


@router.post("/repos/{repo_id}/specs/sync", response_model=SpecSource, status_code=202)
def sync_specs(repo_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    repo = get_or_404(db, GitRepo, repo_id, "Repository")
    if not repo.spec_sync_enabled:
        raise HTTPException(409, "Turn on spec sync for this repository first.")
    _start_spec_sync(db, repo, background)
    count = db.execute(select(func.count(Spec.id)).where(Spec.repo_id == repo.id)).scalar_one()
    return _source(repo, count)
