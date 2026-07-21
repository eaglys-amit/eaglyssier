"""Per-member analysis scope (sprints/repos/date range).

Chosen on the Data tab against the active member; KPI and Evaluation
generation read it via app.services.scope.load_scope.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import GitRepo, Project, ProjectMember, Sprint
from app.schemas.scope import AnalysisScopeIO

router = APIRouter()


def _project_member(db: Session, project_id: int, member_id: int) -> ProjectMember:
    pm = db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .where(ProjectMember.member_id == member_id)
    ).scalars().first()
    if pm is None:
        raise HTTPException(status_code=404, detail="Member is not on this project")
    return pm


@router.get(
    "/projects/{project_id}/members/{member_id}/scope",
    response_model=AnalysisScopeIO,
)
def scope_get(project_id: int, member_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    pm = _project_member(db, project_id, member_id)
    return AnalysisScopeIO.model_validate(pm.analysis_scope or {})


@router.put(
    "/projects/{project_id}/members/{member_id}/scope",
    response_model=AnalysisScopeIO,
)
def scope_put(
    project_id: int,
    member_id: int,
    body: AnalysisScopeIO,
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    pm = _project_member(db, project_id, member_id)

    # Drop ids that don't belong to this project (stale after deletes/removals).
    sprint_ids = set(
        db.execute(select(Sprint.id).where(Sprint.project_id == project_id)).scalars()
    )
    repo_ids = set(
        db.execute(select(GitRepo.id).where(GitRepo.project_id == project_id)).scalars()
    )
    body.sprint_ids = sorted(set(body.sprint_ids) & sprint_ids)
    body.repo_ids = sorted(set(body.repo_ids) & repo_ids)
    if body.start_date and body.end_date and body.start_date > body.end_date:
        body.start_date, body.end_date = body.end_date, body.start_date

    pm.analysis_scope = body.model_dump(mode="json")
    db.commit()
    return AnalysisScopeIO.model_validate(pm.analysis_scope)
