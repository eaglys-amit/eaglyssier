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
    epics,
    evaluation,
    integrations,
    kpi,
    members,
    milestones,
    poker,
    project_members,
    projects,
    provider,
    references,
    repo_docs,
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
    # Rebuilds the hierarchy a flat tracker never sent, which the milestone
    # generator below then has something to work with.
    epics.router,
    # Above the sprint horizon: milestones roll up the same tasks.
    milestones.router,
    poker.router,
    references.router,
    breakdown.router,
    # Per-repo documentation sets: written from the repo summary and commit
    # analyses above, plus whichever reference documents the user picks.
    repo_docs.router,
):
    api_router.include_router(_r)
