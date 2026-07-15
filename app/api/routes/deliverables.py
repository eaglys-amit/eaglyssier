"""Generate project deliverables and report their status."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404, run_in_session
from app.db import get_db
from app.models import Deliverable, Project
from app.schemas.jobs import DeliverableOut, DeliverablesOut
from app.services.deliverables import generate_deliverables

router = APIRouter()


def _out(db: Session, project: Project) -> DeliverablesOut:
    items = db.execute(
        select(Deliverable)
        .where(Deliverable.project_id == project.id)
        .order_by(Deliverable.source.desc(), Deliverable.id)
    ).scalars().all()
    return DeliverablesOut(
        status=project.deliverables_status,
        error=project.deliverables_error,
        model=project.deliverables_model,
        generated_at=project.deliverables_generated_at,
        items=[DeliverableOut.model_validate(d) for d in items],
    )


@router.get("/projects/{project_id}/deliverables", response_model=DeliverablesOut)
def deliverables_list(project_id: int, db: Session = Depends(get_db)):
    return _out(db, get_or_404(db, Project, project_id))


@router.post(
    "/projects/{project_id}/deliverables/generate",
    response_model=DeliverablesOut,
    status_code=202,
)
def generate(project_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    project = get_or_404(db, Project, project_id)
    project.deliverables_status = "running"
    project.deliverables_error = None
    db.commit()
    background.add_task(run_in_session, generate_deliverables, project_id)
    return _out(db, project)
