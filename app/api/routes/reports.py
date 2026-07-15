"""Report metadata: list, generate, delete (artifacts served at /reports/...)."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404, run_in_session
from app.db import get_db
from app.models import Project, Report, ReportStatus
from app.schemas.report_meta import ReportCreateIn, ReportOut
from app.services.reports import generate_report
from app.storage import rustfs

router = APIRouter()


def _report_out(r: Report) -> ReportOut:
    return ReportOut.model_validate(r).model_copy(
        update={
            "status": r.status.value,
            "html_url": f"/reports/{r.id}/view" if r.html_key else None,
            "pdf_url": f"/reports/{r.id}/pdf" if r.pdf_key else None,
        }
    )


@router.get("/projects/{project_id}/reports", response_model=list[ReportOut])
def reports_list(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    reports = db.execute(
        select(Report).where(Report.project_id == project_id).order_by(desc(Report.created_at))
    ).scalars().all()
    return [_report_out(r) for r in reports]


@router.post("/projects/{project_id}/reports", response_model=ReportOut, status_code=202)
def create_report(
    project_id: int,
    body: ReportCreateIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    scope: dict = {}
    if body.scope_mode == "sprints" and body.sprint_ids:
        scope = {"sprint_ids": body.sprint_ids}
    elif body.scope_mode == "dates" and (body.start or body.end):
        scope = {
            "start": body.start.isoformat() if body.start else None,
            "end": body.end.isoformat() if body.end else None,
        }
    # exactly one sprint -> sprint report; otherwise a broader closing/period review
    report_type = "sprint" if len(scope.get("sprint_ids", [])) == 1 else "project"
    report = Report(
        project_id=project_id,
        report_type=report_type,
        scope=scope,
        title="Report (generating…)",
        status=ReportStatus.pending,
    )
    db.add(report)
    db.commit()
    background.add_task(run_in_session, generate_report, report.id)
    return _report_out(report)


@router.delete("/reports/{report_id}", status_code=204)
def delete_report(report_id: int, db: Session = Depends(get_db)):
    report = db.get(Report, report_id)
    if report:
        for key in (report.html_key, report.pdf_key):  # best-effort blob cleanup
            if key:
                try:
                    rustfs.delete_object(key)
                except Exception:  # noqa: BLE001 - a missing blob shouldn't block deletion
                    pass
        db.delete(report)
        db.commit()
