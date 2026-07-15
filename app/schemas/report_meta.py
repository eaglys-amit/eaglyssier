"""Report metadata API schemas (the PDF context lives in schemas/report.py)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.common import ApiModel


class ReportOut(ApiModel):
    id: int
    title: str
    report_type: str
    scope: dict
    status: str
    error: str | None
    generated_at: datetime | None
    created_at: datetime | None
    html_url: str | None = None
    pdf_url: str | None = None


class ReportCreateIn(BaseModel):
    scope_mode: Literal["project", "sprints", "dates"] = "project"
    sprint_ids: list[int] = []
    start: date | None = None
    end: date | None = None
