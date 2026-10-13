"""The portfolio: every visible project's delivery health on one screen.

Built from the same per-project numbers the project pages show — velocity
(app.services.burndown), the roadmap and its milestone health
(app.services.milestones) and the active sprint's leaf tasks — so the overview
can never disagree with the page it links to. One pass per project; fine for a
handful of projects, worth caching if that grows.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Integration,
    Project,
    Sprint,
    SprintSnapshot,
    StatusCategory,
    SyncRun,
    SyncStatus,
    User,
)
from app.schemas.milestone import MilestoneOut
from app.schemas.portfolio import (
    PortfolioMilestone,
    PortfolioOut,
    PortfolioProject,
    PortfolioSprint,
    VelocityPoint,
)
from app.schemas.scrum import VelocityOut
from app.services import burndown as burndown_svc
from app.services import milestones as milestones_svc
from app.services import spec_verify

# Health thresholds. Scope change is measured on the active sprint against the
# commitment it started with; velocity trend is rolling-3 over the average.
SCOPE_RED = 0.25
SCOPE_AMBER = 0.10
VELOCITY_TREND_AMBER = 0.8
MIN_CLOSED_FOR_TREND = 4  # rolling-3 vs an average of 3 says nothing
STALE_SYNC_DAYS = 7
SPARKLINE_SPRINTS = 6

_OPEN_STATES = {"planned", "in_progress"}


def _active_sprint(db: Session, project_id: int) -> PortfolioSprint | None:
    sprint = db.execute(
        select(Sprint)
        .where(Sprint.project_id == project_id, Sprint.state == "active")
        .order_by(Sprint.start_date.desc().nullslast(), Sprint.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if sprint is None:
        return None
    tasks = burndown_svc._leaf_tasks(db, sprint.id)
    total = round(sum(t.story_points or 0.0 for t in tasks), 1)
    done = round(
        sum(t.story_points or 0.0 for t in tasks if t.status_category == StatusCategory.done), 1
    )
    baseline = sprint.committed_points
    if baseline is None:
        # Synced sprints are never "started" here; their first real (not
        # backfilled — those can't see scope change) reading stands in.
        baseline = db.execute(
            select(SprintSnapshot.total_points)
            .where(SprintSnapshot.sprint_id == sprint.id, SprintSnapshot.backfilled.is_(False))
            .order_by(SprintSnapshot.snapshot_date)
            .limit(1)
        ).scalar()
    scope_change = round((total - baseline) / baseline, 3) if baseline else None
    return PortfolioSprint(
        id=sprint.id,
        name=sprint.name,
        start_date=sprint.start_date,
        end_date=sprint.end_date,
        baseline_points=baseline,
        total_points=total,
        completed_points=done,
        progress=round(done / total, 3) if total else 0.0,
        scope_change=scope_change,
    )


def _velocity_trend(velocity: VelocityOut) -> float | None:
    if velocity.closed_count < MIN_CLOSED_FOR_TREND or not velocity.average:
        return None
    return round(velocity.rolling3 / velocity.average, 2)


def _next_milestone(milestones: list[MilestoneOut]) -> PortfolioMilestone | None:
    # All work done but not yet marked released isn't what's "next".
    open_ms = [m for m in milestones if m.state in _OPEN_STATES and m.health != "complete"]
    if not open_ms:
        return None
    # Soonest target first; undated ones after, in roadmap rank order.
    m = min(open_ms, key=lambda m: (m.target_date or date.max, m.rank))
    return PortfolioMilestone(
        id=m.id, name=m.name, target_date=m.target_date, forecast_date=m.forecast_date,
        forecast_p85=m.forecast_p85, on_time_probability=m.on_time_probability,
        days_late=m.days_late, health=m.health, progress=m.progress,
    )


def _last_sync(db: Session, project_id: int) -> tuple[datetime | None, bool]:
    """When data last arrived successfully, and whether the newest run failed."""
    runs = select(SyncRun).join(Integration).where(Integration.project_id == project_id)
    last_ok = db.execute(
        runs.with_only_columns(func.max(SyncRun.finished_at))
        .where(SyncRun.status == SyncStatus.success)
    ).scalar()
    newest = db.execute(runs.order_by(SyncRun.id.desc()).limit(1)).scalar_one_or_none()
    return last_ok, newest is not None and newest.status == SyncStatus.failed


def project_health(
    milestones: list[MilestoneOut],
    sprint: PortfolioSprint | None,
    velocity_trend: float | None,
    last_synced_at: datetime | None = None,
    *,
    stale_reviews: int = 0,
    now: datetime | None = None,
) -> tuple[str, list[str]]:
    """green / amber / red / unknown, plus the reasons it isn't green (worst first)."""
    open_ms = [m for m in milestones if m.state in _OPEN_STATES]
    if sprint is None and not open_ms:
        return "unknown", ["No active sprint or open milestones"]

    red: list[str] = []
    amber: list[str] = []
    for m in open_ms:
        chance = (
            f" ({round(m.on_time_probability * 100)}% likely on time)"
            if m.on_time_probability is not None else ""
        )
        if m.health == "overdue":
            when = f"{m.days_late} days late" if m.days_late else "past its target"
            red.append(f"Milestone “{m.name}” is {when}")
        elif m.health == "off_track":
            red.append(f"Milestone “{m.name}” is unlikely to make its target{chance}")
        elif m.health == "at_risk":
            amber.append(f"Milestone “{m.name}” is at risk{chance}")

    if sprint and sprint.scope_change is not None:
        pct = round(sprint.scope_change * 100)
        if sprint.scope_change > SCOPE_RED:
            red.append(f"Sprint scope grew {pct}% since it started")
        elif sprint.scope_change > SCOPE_AMBER:
            amber.append(f"Sprint scope grew {pct}% since it started")

    if velocity_trend is not None and velocity_trend < VELOCITY_TREND_AMBER:
        amber.append(f"Recent velocity is {round(velocity_trend * 100)}% of the average")

    now = now or datetime.now(timezone.utc)
    if last_synced_at and last_synced_at.tzinfo is None:
        last_synced_at = last_synced_at.replace(tzinfo=timezone.utc)
    if last_synced_at and now - last_synced_at > timedelta(days=STALE_SYNC_DAYS):
        amber.append(f"No successful sync in {(now - last_synced_at).days} days")

    if stale_reviews:
        amber.append(
            f"{stale_reviews} task link{'s' if stale_reviews != 1 else ''} not reviewed "
            f"since the spec changed (over {spec_verify.REVIEW_GRACE_DAYS} days)"
        )

    if red:
        return "red", red + amber
    if amber:
        return "amber", amber
    return "green", []


def build_project_row(db: Session, project: Project, role: str | None) -> PortfolioProject:
    velocity = burndown_svc.build_velocity(db, project.id)
    roadmap = milestones_svc.build_roadmap(db, project.id, velocity=velocity)
    sprint = _active_sprint(db, project.id)
    trend = _velocity_trend(velocity)
    last_synced_at, last_failed = _last_sync(db, project.id)
    coverage, _, stale_reviews = spec_verify.project_coverage(db, project.id)
    health, reasons = project_health(
        roadmap.milestones, sprint, trend, last_synced_at, stale_reviews=stale_reviews
    )

    by_health: dict[str, int] = {}
    for m in roadmap.milestones:
        if m.state in _OPEN_STATES:
            by_health[m.health] = by_health.get(m.health, 0) + 1

    closed = [r for r in velocity.sprints if r.state == "closed"][-SPARKLINE_SPRINTS:]
    return PortfolioProject(
        id=project.id,
        name=project.name,
        key=project.key,
        role=role,
        health=health,
        health_reasons=reasons,
        active_sprint=sprint,
        velocity_rolling3=velocity.rolling3,
        velocity_average=velocity.average,
        velocity_trend=trend,
        velocity_series=[
            VelocityPoint(name=r.name, completed_points=r.completed_points) for r in closed
        ],
        milestones_by_health=by_health,
        next_milestone=_next_milestone(roadmap.milestones),
        last_synced_at=last_synced_at,
        last_sync_failed=last_failed,
        spec_coverage=coverage,
    )


def build_portfolio(db: Session, user: User, roles: dict[int, str]) -> PortfolioOut:
    """Rows for the projects in `roles` (project_id -> role), or all for an admin."""
    stmt = select(Project).order_by(Project.name)
    if not user.is_admin:
        stmt = stmt.where(Project.id.in_(roles or [-1]))
    projects = db.execute(stmt).scalars().all()
    return PortfolioOut(
        projects=[build_project_row(db, p, roles.get(p.id)) for p in projects],
        generated_at=datetime.now(timezone.utc),
    )
