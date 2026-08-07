"""Per-project story-point reference scale."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Project, StoryPointScale
from app.schemas.settings import (
    DeckOut,
    ScaleImportIn,
    ScaleSourceOut,
    ScaleViolationOut,
    StoryPointRowOut,
    StoryPointScaleIn,
)
from app.services import scale as scale_svc

router = APIRouter()

# Default scale (from the team's story-point breakdown). Hours are approximate
# lower/upper focused-effort bounds; the note preserves the original wording.
_DEFAULT_SCALE = [
    (1, 0.5, 3, "None", False, "30 min – 3 hours"),
    (2, 3, 8, "Low", False, "3 hours – 1 day"),
    (3, 6, 24, "Normal", False, "6–8 hours – 2–3 days"),
    (5, 15, 40, "Moderate", False, "15–20 hours – 1 week"),
    (8, 40, 80, "Moderate", False, "1 week – 2 weeks"),
    (13, 80, 160, "High", True, "2 weeks – 1 month · break down"),
]


def _ensure_defaults(db: Session, project_id: int) -> None:
    exists = db.scalar(
        select(StoryPointScale).where(StoryPointScale.project_id == project_id).limit(1)
    )
    if exists is None:
        for pts, lo, hi, risk, brk, note in _DEFAULT_SCALE:
            db.add(
                StoryPointScale(
                    project_id=project_id, points=pts, min_hours=lo, max_hours=hi,
                    risk=risk, needs_breakdown=brk, note=note,
                )
            )
        db.commit()


def _scale(db: Session, project_id: int) -> list[StoryPointScale]:
    return list(
        db.execute(
            select(StoryPointScale)
            .where(StoryPointScale.project_id == project_id)
            .order_by(StoryPointScale.points)
        ).scalars().all()
    )


@router.get("/projects/{project_id}/story-points", response_model=list[StoryPointRowOut])
def story_points(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    _ensure_defaults(db, project_id)
    return _scale(db, project_id)


@router.put("/projects/{project_id}/story-points", response_model=list[StoryPointRowOut])
def save_story_points(project_id: int, body: StoryPointScaleIn, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    # Replace this project's whole scale from the submitted rows.
    db.execute(delete(StoryPointScale).where(StoryPointScale.project_id == project_id))
    seen: set[int] = set()
    for row in body.rows:
        if row.points in seen:
            continue  # (project_id, points) is unique
        seen.add(row.points)
        db.add(
            StoryPointScale(
                project_id=project_id,
                points=row.points,
                min_hours=row.min_hours,
                max_hours=row.max_hours,
                risk=(row.risk or "").strip() or "None",
                needs_breakdown=row.needs_breakdown,
                note=(row.note or "").strip() or None,
            )
        )
    db.commit()
    return _scale(db, project_id)


@router.get("/projects/{project_id}/story-points/deck", response_model=DeckOut)
def story_point_deck(project_id: int, db: Session = Depends(get_db)):
    """The estimation deck: allowed values plus the break-it-down flags.

    Consumed by the task dialog, planning poker, and AI breakdown, so an
    estimate can only ever be a value this project's scale defines.
    """
    get_or_404(db, Project, project_id)
    _ensure_defaults(db, project_id)
    return scale_svc.build_deck(db, project_id)


@router.get(
    "/projects/{project_id}/story-points/sources", response_model=list[ScaleSourceOut]
)
def story_point_sources(project_id: int, db: Session = Depends(get_db)):
    """Other projects whose scale can be copied into this one."""
    get_or_404(db, Project, project_id)
    return scale_svc.scale_sources(db, project_id)


@router.post(
    "/projects/{project_id}/story-points/import", response_model=list[StoryPointRowOut]
)
def import_story_points(
    project_id: int, body: ScaleImportIn, db: Session = Depends(get_db)
):
    """Copy another project's scale in (replace, or merge missing values only)."""
    get_or_404(db, Project, project_id)
    get_or_404(db, Project, body.source_project_id, "Source project")
    if body.source_project_id == project_id:
        raise HTTPException(422, "That is this project's own scale")
    return scale_svc.import_scale(
        db, project_id, body.source_project_id, mode=body.mode
    )


@router.get(
    "/projects/{project_id}/story-points/violations",
    response_model=list[ScaleViolationOut],
)
def story_point_violations(project_id: int, db: Session = Depends(get_db)):
    """Tasks whose estimate disagrees with the scale (advisory, never blocking)."""
    get_or_404(db, Project, project_id)
    return scale_svc.scale_violations(db, project_id)
