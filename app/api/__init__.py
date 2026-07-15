"""JSON API consumed by the React SPA."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    analysis,
    data,
    deliverables,
    integrations,
    kpi,
    members,
    project_members,
    projects,
    provider,
    reports,
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
    analysis.router,
    kpi.router,
    deliverables.router,
    reports.router,
    provider.router,
    settings.router,
):
    api_router.include_router(_r)
