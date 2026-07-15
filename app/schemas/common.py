"""Shared bases for the JSON API schemas (not the PDF report context)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

# Lifecycle of LLM/background jobs tracked via *_status columns.
JobStatus = Literal["none", "idle", "running", "done", "ready", "failed"]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
