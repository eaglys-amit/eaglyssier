"""MBO FORM② evaluation sheet payloads (see app.services.evaluation)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

from app.schemas.common import JobStatus
from app.services.evaluation_prompts import AXIS_KEYS

Grade = Literal["S", "A", "B", "C", "D", "E"]


class AxisCells(BaseModel):
    planned_goal: str = ""
    key_results: str = ""
    self_eval: Grade | None = None
    tech_lead_eval: Grade | None = None
    final_eval: Grade | None = None


class ChecklistItemOut(BaseModel):
    id: str
    status: Literal["PASS", "FAIL"]
    reason: str | None = None
    suggestion: str | None = None


class ChecklistOut(BaseModel):
    verdict: Literal["pass", "fail"]
    items: list[ChecklistItemOut]
    # True when the sheet's goals/results changed after this check ran.
    stale: bool = False


class EvaluationSummaryOut(BaseModel):
    """Member-selector row on the Evaluation tab."""

    member_id: int
    display_name: str
    job_status: JobStatus
    job_kind: str | None
    has_sheet: bool
    checklist_verdict: Literal["pass", "fail"] | None
    checklist_stale: bool = False


class EvaluationSheetOut(BaseModel):
    member_id: int
    display_name: str
    project_key: str | None
    project_name: str
    tech_lead_name: str | None
    axes: dict[str, AxisCells]
    evidence: str | None
    job_status: JobStatus
    job_kind: str | None
    job_error: str | None
    job_model: str | None
    goals_generated_at: datetime | None
    results_generated_at: datetime | None
    checked_at: datetime | None
    checklist: ChecklistOut | None
    updated_at: datetime | None


class EvaluationSheetIn(BaseModel):
    """PUT body — only the user-editable parts of the sheet.

    `axes` is merged per axis key: keys omitted from the body keep their stored
    content, so a partial payload can never blank the other axes.
    """

    tech_lead_name: str | None = None
    axes: dict[str, AxisCells] = {}
    evidence: str | None = None

    @field_validator("axes")
    @classmethod
    def _known_axes_only(cls, v: dict[str, AxisCells]) -> dict[str, AxisCells]:
        unknown = set(v) - set(AXIS_KEYS)
        if unknown:
            raise ValueError(f"unknown axis keys: {sorted(unknown)}")
        return v
