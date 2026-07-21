"""MBO FORM② evaluation sheets: read/save + AI generation jobs."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_or_404, run_in_session
from app.db import get_db
from app.models import EvaluationSheet, Project, ProjectMember
from app.schemas.evaluation import (
    EvaluationSheetIn,
    EvaluationSheetOut,
    EvaluationSummaryOut,
)
from app.services.evaluation import (
    claim_job,
    default_axes,
    generate_goals,
    generate_results,
    get_or_create_sheet,
    run_checklist,
)

router = APIRouter()

# URL slug -> (job kind stored on the sheet, background worker).
_JOBS = {
    "generate-goals": ("goals", generate_goals),
    "generate-results": ("results", generate_results),
    "validate": ("checklist", run_checklist),
}


def _sheet_out(project: Project, member_id: int, display_name: str,
               sheet: EvaluationSheet | None) -> EvaluationSheetOut:
    if sheet is None:
        return EvaluationSheetOut(
            member_id=member_id,
            display_name=display_name,
            project_key=project.key,
            project_name=project.name,
            tech_lead_name=None,
            axes=default_axes(),
            evidence=None,
            job_status="none",
            job_kind=None,
            job_error=None,
            job_model=None,
            goals_generated_at=None,
            results_generated_at=None,
            checked_at=None,
            checklist=None,
            updated_at=None,
        )
    return EvaluationSheetOut(
        member_id=member_id,
        display_name=display_name,
        project_key=project.key,
        project_name=project.name,
        tech_lead_name=sheet.tech_lead_name,
        axes={**default_axes(), **(sheet.axes or {})},
        evidence=sheet.evidence,
        job_status=sheet.job_status,
        job_kind=sheet.job_kind,
        job_error=sheet.job_error,
        job_model=sheet.job_model,
        goals_generated_at=sheet.goals_generated_at,
        results_generated_at=sheet.results_generated_at,
        checked_at=sheet.checked_at,
        checklist=sheet.checklist,
        updated_at=sheet.updated_at,
    )


def _get_pm(db: Session, project_id: int, member_id: int) -> ProjectMember:
    pm = db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .where(ProjectMember.member_id == member_id)
        .options(selectinload(ProjectMember.member))
    ).scalars().first()
    if pm is None:
        raise HTTPException(status_code=404, detail="Member is not on this project")
    return pm


def _get_sheet(db: Session, project_id: int, member_id: int) -> EvaluationSheet | None:
    return db.execute(
        select(EvaluationSheet)
        .where(EvaluationSheet.project_id == project_id)
        .where(EvaluationSheet.member_id == member_id)
    ).scalars().first()


def _reject_if_running(sheet: EvaluationSheet | None) -> None:
    if sheet is not None and sheet.job_status == "running":
        raise HTTPException(
            status_code=409,
            detail="Generation is running; wait for it to finish first.",
        )


@router.get("/projects/{project_id}/evaluation", response_model=list[EvaluationSummaryOut])
def evaluation_list(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    pms = db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .options(selectinload(ProjectMember.member))
    ).scalars().all()
    # Polled every 2s while a job runs — skip the heavy axes/evidence columns.
    sheets = {
        row.member_id: row
        for row in db.execute(
            select(
                EvaluationSheet.member_id,
                EvaluationSheet.job_status,
                EvaluationSheet.job_kind,
                EvaluationSheet.checklist,
            ).where(EvaluationSheet.project_id == project_id)
        ).all()
    }
    out = []
    for pm in sorted(pms, key=lambda pm: pm.member.display_name):
        sheet = sheets.get(pm.member_id)
        checklist = (sheet.checklist or {}) if sheet else {}
        out.append(
            EvaluationSummaryOut(
                member_id=pm.member_id,
                display_name=pm.member.display_name,
                job_status=sheet.job_status if sheet else "none",
                job_kind=sheet.job_kind if sheet else None,
                has_sheet=sheet is not None,
                checklist_verdict=checklist.get("verdict"),
                checklist_stale=bool(checklist.get("stale")),
            )
        )
    return out


@router.get(
    "/projects/{project_id}/evaluation/{member_id}", response_model=EvaluationSheetOut
)
def evaluation_get(project_id: int, member_id: int, db: Session = Depends(get_db)):
    project = get_or_404(db, Project, project_id)
    pm = _get_pm(db, project_id, member_id)
    return _sheet_out(project, member_id, pm.member.display_name,
                      _get_sheet(db, project_id, member_id))


@router.put(
    "/projects/{project_id}/evaluation/{member_id}", response_model=EvaluationSheetOut
)
def evaluation_save(
    project_id: int,
    member_id: int,
    body: EvaluationSheetIn,
    db: Session = Depends(get_db),
):
    project = get_or_404(db, Project, project_id)
    pm = _get_pm(db, project_id, member_id)
    _reject_if_running(_get_sheet(db, project_id, member_id))

    sheet = get_or_create_sheet(db, project_id, member_id)
    # Merge per axis key so a partial payload never blanks the other axes.
    axes = {**default_axes(), **(sheet.axes or {})}
    for k, cells in body.axes.items():
        axes[k] = cells.model_dump()
    content_changed = axes != (sheet.axes or {}) or (body.evidence or None) != sheet.evidence

    sheet.tech_lead_name = body.tech_lead_name
    sheet.axes = axes
    sheet.evidence = body.evidence
    if content_changed and isinstance(sheet.checklist, dict) and not sheet.checklist.get("stale"):
        sheet.checklist = {**sheet.checklist, "stale": True}
    db.commit()
    db.refresh(sheet)
    return _sheet_out(project, member_id, pm.member.display_name, sheet)


@router.post(
    "/projects/{project_id}/evaluation/{member_id}/{job}",
    response_model=EvaluationSheetOut,
    status_code=202,
)
def evaluation_job(
    project_id: int,
    member_id: int,
    job: str,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    if job not in _JOBS:
        raise HTTPException(status_code=404, detail="Unknown job")
    kind, fn = _JOBS[job]
    project = get_or_404(db, Project, project_id)
    pm = _get_pm(db, project_id, member_id)

    sheet = get_or_create_sheet(db, project_id, member_id)
    # Atomic claim: flips to "running" only if no job is running, so two
    # near-simultaneous POSTs can't both start an LLM job on this sheet.
    if not claim_job(db, sheet, kind):
        raise HTTPException(
            status_code=409,
            detail="Generation is running; wait for it to finish first.",
        )
    background.add_task(run_in_session, fn, project_id, member_id)
    return _sheet_out(project, member_id, pm.member.display_name, sheet)
