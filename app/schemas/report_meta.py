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
    # "executive": the outcome-first summary for product leadership; the scope
    # below still sets the period its delivery numbers and "what shipped" cover.
    report_type: Literal["standard", "executive"] = "standard"
    scope_mode: Literal["project", "sprints", "dates"] = "project"
    sprint_ids: list[int] = []
    start: date | None = None
    end: date | None = None


class ExecScheduleIn(BaseModel):
    weekly: bool
