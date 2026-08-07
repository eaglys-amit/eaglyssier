"""Story-point scale API schemas."""
from __future__ import annotations

from typing import Literal

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


class DeckOut(BaseModel):
    """The estimation card deck, derived from the project's scale."""
    points: list[int] = []
    # Values the scale flags as too big to work on directly.
    needs_breakdown: list[int] = []
    # points -> the scale row's note, for a card tooltip.
    labels: dict[str, str] = {}


class ScaleSourceOut(BaseModel):
    """A project whose scale can be copied."""
    project_id: int
    project_name: str
    project_key: str | None
    row_count: int


class ScaleImportIn(BaseModel):
    source_project_id: int
    # replace = mirror the source exactly; merge = only add missing point values.
    mode: Literal["replace", "merge"] = "replace"


class ScaleViolationOut(BaseModel):
    """A task whose estimate disagrees with the scale."""
    task_id: int
    task_key: str
    title: str
    kind: Literal["off_deck", "needs_breakdown", "hours_below_min", "hours_above_max"]
    points: float | None
    hours: float | None
    min_hours: float | None
    max_hours: float | None
    message: str
