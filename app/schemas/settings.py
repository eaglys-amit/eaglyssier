"""Story-point scale API schemas."""
from __future__ import annotations

from pydantic import BaseModel

from app.schemas.common import ApiModel


class StoryPointRowOut(ApiModel):
    id: int
    points: int
    min_hours: float | None
    max_hours: float | None
    risk: str
    needs_breakdown: bool
    note: str | None


class StoryPointRowIn(BaseModel):
    points: int
    min_hours: float | None = None
    max_hours: float | None = None
    risk: str = "None"
    needs_breakdown: bool = False
    note: str | None = None


class StoryPointScaleIn(BaseModel):
    rows: list[StoryPointRowIn]
