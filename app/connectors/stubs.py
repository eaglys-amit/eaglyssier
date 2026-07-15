"""Stub connectors for Slack and Google Workspace.

Registered so the UI can list them, but not implemented in iteration 1. They
raise ConnectorError with a clear message if a sync is attempted.
"""
from __future__ import annotations

from app.connectors.base import BaseConnector, ConnectorError
from app.models import IntegrationType


class SlackConnector(BaseConnector):
    kind = IntegrationType.slack

    def test_connection(self) -> bool:
        raise ConnectorError("Slack integration is not implemented yet (planned).")


class GoogleWorkspaceConnector(BaseConnector):
    kind = IntegrationType.google

    def test_connection(self) -> bool:
        raise ConnectorError("Google Workspace integration is not implemented yet (planned).")
