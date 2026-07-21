"""Sprint capacity: focus factor per member, allocated vs completed points."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Project, Sprint, SprintMemberCapacity
from app.schemas.capacity import SprintCapacityIn, SprintCapacityOut
from app.services.capacity import build_project_capacity, build_sprint_capacity

router = APIRouter()


@router.get("/projects/{project_id}/capacity", response_model=list[SprintCapacityOut])
def project_capacity(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    return build_project_capacity(db, project_id)


@router.put(
    "/projects/{project_id}/sprints/{sprint_id}/capacity",
    response_model=SprintCapacityOut,
)
def save_sprint_capacity(
    project_id: int,
    sprint_id: int,
    body: SprintCapacityIn,
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.project_id != project_id:
        raise HTTPException(404, "Sprint not found")

    # working-days override (None clears it -> falls back to computed business days)
    sprint.working_days = body.working_days

    existing = {
        c.member_id: c
        for c in db.execute(
            select(SprintMemberCapacity).where(
                SprintMemberCapacity.sprint_id == sprint_id
            )
        ).scalars()
    }
    for m in body.members:
        ff = max(0.0, min(1.0, m.focus_factor))
        row = existing.get(m.member_id)
        if ff <= 0.0:
            # unallocated -> drop any stored row
            if row is not None:
                db.delete(row)
        elif row is not None:
            row.focus_factor = ff
        else:
            db.add(
                SprintMemberCapacity(
                    sprint_id=sprint_id, member_id=m.member_id, focus_factor=ff
                )
            )
    db.commit()

    result = build_sprint_capacity(db, project_id, sprint_id)
    if result is None:
        raise HTTPException(404, "Sprint not found")
    return result
