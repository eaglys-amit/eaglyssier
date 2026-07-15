"""Connector interfaces.

Two capability protocols keep the sync orchestration simple:
  * IssueTrackerConnector  -> sprints + tasks (Jira)
  * GitConnector           -> repos + commits + pull requests (GitHub/GitLab)

A connector may implement one or both. The sync service checks capability by
isinstance and drives whatever the connector supports.
"""
from __future__ import annotations

from collections.abc import Iterable

from app.connectors.dto import (
    CommitDiffDTO,
    CommitDTO,
    PullRequestDTO,
    RepoDTO,
    SprintDTO,
    TaskDTO,
)
from app.models import IntegrationType


class ConnectorError(RuntimeError):
    """Raised for auth/transport/parse failures so sync can record them cleanly."""


class BaseConnector:
    kind: IntegrationType

    def __init__(self, base_url: str | None, token: str | None, config: dict):
        self.base_url = (base_url or "").rstrip("/")
        self.token = token
        self.config = config or {}

    def test_connection(self) -> bool:  # pragma: no cover - optional
        raise NotImplementedError


class IssueTrackerConnector(BaseConnector):
    def fetch_sprints(self) -> Iterable[SprintDTO]:
        raise NotImplementedError

    def fetch_tasks(self) -> Iterable[TaskDTO]:
        raise NotImplementedError


class GitConnector(BaseConnector):
    def fetch_repos(self) -> Iterable[RepoDTO]:
        raise NotImplementedError

    def fetch_commits(self, repo: RepoDTO) -> Iterable[CommitDTO]:
        raise NotImplementedError

    def fetch_commit_diff(self, repo: RepoDTO, sha: str) -> CommitDiffDTO:
        raise NotImplementedError

    def fetch_pull_requests(self, repo: RepoDTO) -> Iterable[PullRequestDTO]:
        raise NotImplementedError
