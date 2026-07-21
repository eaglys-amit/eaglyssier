"""JSON API consumed by the React SPA."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    analysis,
    capacity,
    data,
    deliverables,
    evaluation,
    integrations,
    kpi,
    members,
    project_members,
    projects,
    provider,
    reports,
    scope,
    settings,
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
):
    api_router.include_router(_r)
