"""Build a connector instance from a stored Integration row."""
from __future__ import annotations

from app.connectors.base import BaseConnector, ConnectorError
from app.connectors.github import GitHubConnector
from app.connectors.gitlab import GitLabConnector
from app.connectors.jira import JiraConnector
from app.connectors.stubs import GoogleWorkspaceConnector, SlackConnector
from app.models import Integration, IntegrationType
from app.services.crypto import decrypt

_REGISTRY: dict[IntegrationType, type[BaseConnector]] = {
    IntegrationType.jira: JiraConnector,
    IntegrationType.github: GitHubConnector,
    IntegrationType.gitlab: GitLabConnector,
    IntegrationType.slack: SlackConnector,
    IntegrationType.google: GoogleWorkspaceConnector,
}


def build_connector(integration: Integration) -> BaseConnector:
    cls = _REGISTRY.get(integration.type)
    if cls is None:
        raise ConnectorError(f"No connector for integration type {integration.type}")
    token = decrypt(integration.credentials_enc) if integration.credentials_enc else None
    return cls(base_url=integration.base_url, token=token, config=integration.config or {})
