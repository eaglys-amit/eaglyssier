"""Integration configuration and sync API schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ApiModel


class IntegrationOut(ApiModel):
    id: int
    type: str
    base_url: str | None
    enabled: bool
    config: dict
    has_credentials: bool = False


class IntegrationTypeOut(BaseModel):
    key: str
    label: str
    configurable: bool


class ProjectIntegrationsOut(BaseModel):
    types: list[IntegrationTypeOut]
    items: list[IntegrationOut]


class IntegrationIn(BaseModel):
    """Create-or-update body for PUT /projects/{id}/integrations/{type}.

    `token` empty/omitted keeps the stored credentials. `config` carries the
    per-platform fields (email/project_key/board_id/... or repos/projects/
    max_commits); it is normalized per type in the route.
    """

    base_url: str | None = None
    token: str | None = None
    enabled: bool = True
    config: dict = {}


class TestResultOut(BaseModel):
    ok: bool
    message: str


class RepoDiscoveryIn(BaseModel):
    """Body for the repo picker: enough to talk to the platform, nothing stored.

    `token` blank falls back to the integration's saved credentials, so the
    picker can be refreshed while editing without retyping the token.
    """

    owner: str | None = None
    base_url: str | None = None
    token: str | None = None


class DiscoveredRepoOut(BaseModel):
    full_name: str
    url: str | None = None
    description: str | None = None
    private: bool = False
    archived: bool = False
    updated_at: datetime | None = None


class RepoDiscoveryOut(BaseModel):
    owner: str | None = None
    repos: list[DiscoveredRepoOut]


class SyncRunOut(ApiModel):
    id: int
    integration_id: int
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    stats: dict | None
    error: str | None


class SyncRunListItem(SyncRunOut):
    # Filled from the joined integration via model_copy in the route; the default
    # lets model_validate(ORM row) pass before that update is applied.
    integration_type: str = ""


class SyncStatusOut(BaseModel):
    integration_id: int
    syncing: bool
    run: SyncRunOut | None = None
