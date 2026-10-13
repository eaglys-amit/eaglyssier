"""Specs and requirements: create from documents, versions, edits, task links."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_or_404, run_in_session
from app.api.routes.references import _read_capped
from app.db import get_db
from app.models import Project, Task
from app.schemas.spec import (
    RequirementBrief,
    RequirementIn,
    RequirementLinkIn,
    RequirementPatchIn,
    SpecCreateIn,
    SpecDetail,
    SpecPatchIn,
    SpecSummary,
    TaskRequirement,
)
from app.services import references as refs
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
