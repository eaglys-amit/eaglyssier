"""Analysis scope schema: persisted member/sprint/repo/date selection per project."""
from __future__ import annotations

from datetime import date

from app.schemas.common import ApiModel


class AnalysisScopeIO(ApiModel):
    """GET response and PUT body for a member's analysis scope (full replace):
    /projects/{id}/members/{member_id}/scope.

    Empty lists / null dates mean "no constraint from that dimension".
    """

    sprint_ids: list[int] = []
    repo_ids: list[int] = []
    start_date: date | None = None
    end_date: date | None = None
