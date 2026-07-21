"""GitLab connector (REST v4).

Config keys:
  projects    -> list of project ids or url-encoded "group/project" paths (required)
  max_commits -> per-repo commit cap (default 500)
Credentials blob: a GitLab personal/project access token.
base_url defaults to https://gitlab.com/api/v4 (override for self-hosted).
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

import httpx

from app.connectors.base import ConnectorError, GitConnector
from app.connectors.dto import (
    CommitDiffDTO,
    CommitDTO,
    CommitFileDTO,
    IdentityDTO,
    PullRequestDTO,
    RepoDTO,
    ReviewDTO,
)
from app.models import IntegrationType

_API = "https://gitlab.com/api/v4"


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class GitLabConnector(GitConnector):
    kind = IntegrationType.gitlab

    def _client(self) -> httpx.Client:
        if not self.token:
            raise ConnectorError("GitLab requires an access token.")
        return httpx.Client(
            base_url=self.base_url or _API,
            headers={"PRIVATE-TOKEN": self.token},
            timeout=30.0,
        )

    def test_connection(self) -> bool:
        # Test access to a configured project rather than /user: project & group
        # access tokens (a common choice) are not tied to a user, so /user 403s
        # for them even when they can read the repos we actually sync. Falls back
        # to /version when no projects are configured yet.
        projects = self.config.get("projects") or []
        with self._client() as c:
            if projects:
                enc = str(projects[0]).replace("/", "%2F")
                path = f"/projects/{enc}"
            else:
                path = "/version"
            r = c.get(path)
        if r.status_code == 200:
            return True
        hint = ""
        if r.status_code in (401, 403):
            hint = (
                " — check the token is valid/unexpired, has the 'read_api' (or "
                "'api') scope, and can access the configured project(s)."
            )
        raise ConnectorError(f"GitLab {path} returned {r.status_code}{hint}")

    def _paginate(self, client: httpx.Client, path: str, params: dict | None = None):
        params = dict(params or {})
        params.setdefault("per_page", 100)
        page = 1
        while True:
            params["page"] = page
            r = client.get(path, params=params)
            if r.status_code >= 400:
                raise ConnectorError(f"GitLab {path} failed: {r.status_code} {r.text[:200]}")
            batch = r.json()
            if not batch:
                break
            yield from batch
            next_page = r.headers.get("x-next-page")
            if not next_page:
                break
            page = int(next_page)

    def fetch_repos(self) -> Iterable[RepoDTO]:
        projects = self.config.get("projects") or []
        if not projects:
            raise ConnectorError("GitLab integration config missing 'projects' list.")
        out: list[RepoDTO] = []
        with self._client() as c:
            for pid in projects:
                enc = str(pid).replace("/", "%2F")
                r = c.get(f"/projects/{enc}")
                if r.status_code >= 400:
                    raise ConnectorError(f"GitLab project {pid} failed: {r.status_code}")
                d = r.json()
                out.append(
                    RepoDTO(
                        external_id=str(d["id"]),
                        name=d.get("path_with_namespace", str(pid)),
                        url=d.get("web_url"),
                    )
                )
        return out

    def fetch_commits(self, repo: RepoDTO) -> Iterable[CommitDTO]:
        max_commits = int(self.config.get("max_commits", 500))
        out: list[CommitDTO] = []
        with self._client() as c:
            for item in self._paginate(
                c, f"/projects/{repo.external_id}/repository/commits", {"with_stats": "true"}
            ):
                stats = item.get("stats", {})
                out.append(
                    CommitDTO(
                        sha=item["id"],
                        author=IdentityDTO(
                            external_id=item.get("author_email") or item.get("author_name", "unknown"),
                            email=item.get("author_email"),
                            display_name=item.get("author_name"),
                        ),
                        authored_at=_parse_dt(item.get("authored_date") or item.get("created_at")),
                        additions=stats.get("additions", 0),
                        deletions=stats.get("deletions", 0),
                        files_changed=0,  # GitLab commit stats expose line totals, not file count
                        message=item.get("message"),
                        is_merge=len(item.get("parent_ids") or []) > 1,
                    )
                )
                if len(out) >= max_commits:
                    break
        return out

    def fetch_commit_diff(self, repo: RepoDTO, sha: str) -> CommitDiffDTO:
        with self._client() as c:
            r = c.get(f"/projects/{repo.external_id}/repository/commits/{sha}/diff")
            if r.status_code >= 400:
                raise ConnectorError(
                    f"GitLab commit {sha} failed: {r.status_code} {r.text[:200]}"
                )
            entries = r.json() or []
        files: list[CommitFileDTO] = []
        for e in entries:
            if e.get("new_file"):
                status = "added"
            elif e.get("deleted_file"):
                status = "removed"
            elif e.get("renamed_file"):
                status = "renamed"
            else:
                status = "modified"
            files.append(
                CommitFileDTO(
                    path=e.get("new_path") or e.get("old_path") or "?",
                    status=status,
                    patch=e.get("diff"),
                )
            )
        return CommitDiffDTO(sha=sha, files=files)

    @staticmethod
    def _identity(user: dict | None) -> IdentityDTO | None:
        if not user:
            return None
        return IdentityDTO(
            external_id=str(user.get("id") or user.get("username")),
            username=user.get("username"),
            display_name=user.get("name"),
        )

    def fetch_pull_requests(self, repo: RepoDTO) -> Iterable[PullRequestDTO]:
        out: list[PullRequestDTO] = []
        with self._client() as c:
            for mr in self._paginate(
                c, f"/projects/{repo.external_id}/merge_requests", {"state": "all", "order_by": "updated_at"}
            ):
                iid = mr["iid"]
                reviews: list[ReviewDTO] = []
                appr = c.get(f"/projects/{repo.external_id}/merge_requests/{iid}/approvals")
                if appr.status_code < 400:
                    for a in appr.json().get("approved_by", []):
                        user = a.get("user", a)
                        reviews.append(
                            ReviewDTO(
                                external_id=f"{iid}-{user.get('id')}",
                                reviewer=self._identity(user),
                                state="approved",
                            )
                        )
                state = "merged" if mr.get("merged_at") else mr.get("state")
                out.append(
                    PullRequestDTO(
                        external_id=str(iid),
                        title=mr.get("title"),
                        state=state,
                        author=self._identity(mr.get("author")),
                        changed_files=int(mr.get("changes_count") or 0),
                        created_at=_parse_dt(mr.get("created_at")),
                        merged_at=_parse_dt(mr.get("merged_at")),
                        reviews=reviews,
                    )
                )
        return out
