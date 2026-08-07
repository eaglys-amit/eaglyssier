"""JSON API consumed by the React SPA."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    analysis,
    backlog,
    breakdown,
    capacity,
    data,
    deliverables,
    evaluation,
    integrations,
    kpi,
    members,
    poker,
    project_members,
    projects,
    provider,
    references,
    reports,
    scope,
    settings,
    sprints,
    sync,
)

api_router = APIRouter(prefix="/api")
for _r in (
    projects.router,
    members.router,
    project_members.router,
    integrations.router,
    sync.router,
    data.router,
    scope.router,
    analysis.router,
    kpi.router,
    capacity.router,
    evaluation.router,
    deliverables.router,
    reports.router,
    provider.router,
    settings.router,
    # Scrums: the write side of sprints/tasks (reads stay in data.router).
    backlog.router,
    sprints.router,
    poker.router,
    references.router,
    breakdown.router,
):
    api_router.include_router(_r)
