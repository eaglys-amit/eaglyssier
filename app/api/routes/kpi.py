"""Per-member KPI generation and status."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_or_404, run_in_session
from app.db import get_db
from app.models import Project, ProjectMember
from app.schemas.jobs import KpiGenerateIn, KpiOut
from app.services.kpi import generate_kpis

router = APIRouter()


def _kpi_out(pm: ProjectMember) -> KpiOut:
    return KpiOut(
        member_id=pm.member_id,
        display_name=pm.member.display_name,
        status=pm.kpi_status,
        kpi=pm.kpi,
        error=pm.kpi_error,
        model=pm.kpi_model,
        generated_at=pm.kpi_generated_at,
    )


def _project_members(db: Session, project_id: int) -> list[ProjectMember]:
    rows = db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .options(selectinload(ProjectMember.member))
    ).scalars().all()
    return sorted(rows, key=lambda pm: pm.member.display_name)


@router.get("/projects/{project_id}/kpi", response_model=list[KpiOut])
def kpi_list(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    return [_kpi_out(pm) for pm in _project_members(db, project_id)]


@router.post("/projects/{project_id}/kpi", response_model=list[KpiOut], status_code=202)
def generate(
    project_id: int,
    body: KpiGenerateIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    # Only members actually on this project; ignore anything stale in the request.
    rows = db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .where(ProjectMember.member_id.in_(body.member_ids or [-1]))
    ).scalars().all()
    ids = [pm.member_id for pm in rows]
    for pm in rows:
        pm.kpi_status = "running"
        pm.kpi_error = None
    db.commit()
    if ids:
        background.add_task(run_in_session, generate_kpis, project_id, ids)
    return [_kpi_out(pm) for pm in _project_members(db, project_id)]
