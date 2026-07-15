"""Project CRUD + analysis provider/model settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Project, Task
from app.schemas.project import (
    AnalysisProviderOut,
    ProjectCreate,
    ProjectDetail,
    ProjectListItem,
    ProjectPatch,
)
from app.services import analyzers

router = APIRouter()

# Model aliases offered in the Provider tab (Claude CLI). "" = provider default.
CLAUDE_MODELS = ["", "opus", "sonnet", "haiku"]


def _detail(project: Project) -> ProjectDetail:
    detail = ProjectDetail.model_validate(project)
    detail.analysis_providers = [
        AnalysisProviderOut(key=k, label=v, available=analyzers.is_available(k))
        for k, v in analyzers.PROVIDERS.items()
    ]
    detail.claude_models = CLAUDE_MODELS
    return detail


@router.get("/projects", response_model=list[ProjectListItem])
def list_projects(db: Session = Depends(get_db)):
    projects = db.execute(select(Project).order_by(Project.name)).scalars().all()
    counts = dict(
        db.execute(
            select(Task.project_id, func.count(Task.id)).group_by(Task.project_id)
        ).all()
    )
    return [
        ProjectListItem.model_validate(p).model_copy(update={"task_count": counts.get(p.id, 0)})
        for p in projects
    ]


@router.post("/projects", response_model=ProjectDetail, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(
        name=body.name.strip(),
        key=(body.key or "").strip() or None,
        description=(body.description or "").strip() or None,
    )
    db.add(project)
    db.commit()
    return _detail(project)


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def project_detail(project_id: int, db: Session = Depends(get_db)):
    return _detail(get_or_404(db, Project, project_id))


@router.patch("/projects/{project_id}", response_model=ProjectDetail)
def patch_project(project_id: int, body: ProjectPatch, db: Session = Depends(get_db)):
    project = get_or_404(db, Project, project_id)
    if body.name is not None:
        project.name = body.name.strip()
    if body.description is not None:
        project.description = body.description.strip() or None
    if body.analysis_provider is not None:
        if body.analysis_provider not in analyzers.PROVIDERS or not analyzers.is_available(
            body.analysis_provider
        ):
            raise HTTPException(400, "Unsupported analysis provider")
        project.analysis_provider = body.analysis_provider
    if body.analysis_model is not None:
        if body.analysis_model not in CLAUDE_MODELS:
            raise HTTPException(400, "Unsupported model")
        project.analysis_model = body.analysis_model or None
    db.commit()
    return _detail(project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if project:
        db.delete(project)
        db.commit()
