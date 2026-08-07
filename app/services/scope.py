"""Shared analysis-scope filtering for KPI and Evaluation generation.

The scope is persisted per member on ProjectMember.analysis_scope (see
app.schemas.scope) and chosen on the Data tab against the active member. All
dimensions combine with AND; an empty id set or a null date bound means "no
constraint from that dimension".

Date semantics (end date inclusive — the range is [start 00:00 UTC,
end + 1 day 00:00 UTC)):
- commits by Commit.authored_at
- PRs by PullRequest.created_at_src (merged counts stay the merged subset of
  the in-range PRs)
- reviews by PRReview.submitted_at
- tasks by coalesce(resolved_at_src, updated_at_src, created_at_src); tasks
  with none of these set drop out when a bound is set
- sprint selection excludes backlog (null-sprint) tasks when non-empty
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Commit, GitRepo, ProjectMember, PRReview, PullRequest, Task


@dataclass(frozen=True)
class AnalysisScope:
    sprint_ids: frozenset[int]
    repo_ids: frozenset[int]
    start: datetime | None  # UTC start-of-day of start_date
    end: datetime | None  # exclusive: UTC start-of-day of end_date + 1 day


EMPTY_SCOPE = AnalysisScope(frozenset(), frozenset(), None, None)


def _ids(raw: object) -> frozenset[int]:
    if not isinstance(raw, list):
        return frozenset()
    return frozenset(v for v in raw if isinstance(v, int))


def _day_start(raw: object, *, next_day: bool = False) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        d = date.fromisoformat(raw)
    except ValueError:
        return None
    if next_day:
        d = d + timedelta(days=1)
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def load_scope(db: Session, project_id: int, member_id: int) -> AnalysisScope:
    """Read a member's persisted scope; EMPTY_SCOPE when unset/invalid."""
    pm = db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .where(ProjectMember.member_id == member_id)
    ).scalars().first()
    raw = pm.analysis_scope if pm else None
    if not isinstance(raw, dict):
        return EMPTY_SCOPE
    return AnalysisScope(
        sprint_ids=_ids(raw.get("sprint_ids")),
        repo_ids=_ids(raw.get("repo_ids")),
        start=_day_start(raw.get("start_date")),
        end=_day_start(raw.get("end_date"), next_day=True),
    )


def scoped_repo_ids(db: Session, project_id: int, scope: AnalysisScope) -> list[int]:
    """The project's repo ids, narrowed to the scope's selection when non-empty."""
    repo_ids = db.execute(
        select(GitRepo.id).where(GitRepo.project_id == project_id)
    ).scalars().all()
    if scope.repo_ids:
        return [rid for rid in repo_ids if rid in scope.repo_ids]
    return list(repo_ids)


def task_conditions(scope: AnalysisScope) -> list:
    conds = []
    if scope.sprint_ids:
        conds.append(Task.sprint_id.in_(scope.sprint_ids))
    # created_at is the last resort: locally-created tasks may carry no
    # connector timestamps at all, and without it a date-bounded scope would
    # silently drop them from every KPI and evaluation.
    activity = func.coalesce(
        Task.resolved_at_src, Task.updated_at_src, Task.created_at_src, Task.created_at
    )
    if scope.start is not None:
        conds.append(activity >= scope.start)
    if scope.end is not None:
        conds.append(activity < scope.end)
    return conds


def commit_conditions(scope: AnalysisScope) -> list:
    conds = []
    if scope.start is not None:
        conds.append(Commit.authored_at >= scope.start)
    if scope.end is not None:
        conds.append(Commit.authored_at < scope.end)
    return conds


def pr_conditions(scope: AnalysisScope) -> list:
    conds = []
    if scope.start is not None:
        conds.append(PullRequest.created_at_src >= scope.start)
    if scope.end is not None:
        conds.append(PullRequest.created_at_src < scope.end)
    return conds


def review_conditions(scope: AnalysisScope) -> list:
    conds = []
    if scope.start is not None:
        conds.append(PRReview.submitted_at >= scope.start)
    if scope.end is not None:
        conds.append(PRReview.submitted_at < scope.end)
    return conds
