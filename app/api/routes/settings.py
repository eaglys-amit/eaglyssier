"""Global settings — story-point scale."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import StoryPointScale
from app.schemas.settings import StoryPointRowOut, StoryPointScaleIn

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


def _ensure_defaults(db: Session) -> None:
    if db.scalar(select(StoryPointScale).limit(1)) is None:
        for pts, lo, hi, risk, brk, note in _DEFAULT_SCALE:
            db.add(
                StoryPointScale(
                    points=pts, min_hours=lo, max_hours=hi, risk=risk,
                    needs_breakdown=brk, note=note,
                )
            )
        db.commit()


def _scale(db: Session) -> list[StoryPointScale]:
    return list(
        db.execute(select(StoryPointScale).order_by(StoryPointScale.points)).scalars().all()
    )


@router.get("/settings/story-points", response_model=list[StoryPointRowOut])
def story_points(db: Session = Depends(get_db)):
    _ensure_defaults(db)
    return _scale(db)


@router.put("/settings/story-points", response_model=list[StoryPointRowOut])
def save_story_points(body: StoryPointScaleIn, db: Session = Depends(get_db)):
    # Replace the whole scale from the submitted rows.
    db.execute(delete(StoryPointScale))
    seen: set[int] = set()
    for row in body.rows:
        if row.points in seen:
            continue  # points is unique
        seen.add(row.points)
        db.add(
            StoryPointScale(
                points=row.points,
                min_hours=row.min_hours,
                max_hours=row.max_hours,
                risk=(row.risk or "").strip() or "None",
                needs_breakdown=row.needs_breakdown,
                note=(row.note or "").strip() or None,
            )
        )
    db.commit()
    return _scale(db)
