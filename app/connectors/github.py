"""GitHub connector (REST v3).

Config keys:
  repos       -> list of "owner/name" full names to analyze (required)
  max_commits -> per-repo commit cap for stats fetch (default 300)
Credentials blob: a GitHub personal access token (or fine-grained token).
base_url defaults to https://api.github.com (override for GitHub Enterprise).
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

_API = "https://api.github.com"


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class GitHubConnector(GitConnector):
    kind = IntegrationType.github

    def _client(self) -> httpx.Client:
        if not self.token:
            raise ConnectorError("GitHub requires an access token.")
        return httpx.Client(
            base_url=self.base_url or _API,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=30.0,
        )

    def test_connection(self) -> bool:
        with self._client() as c:
            r = c.get("/rate_limit")  # requires a valid token, cheap
            return r.status_code == 200

    def _paginate(self, client: httpx.Client, path: str, params: dict | None = None):
        params = dict(params or {})
        params.setdefault("per_page", 100)
        page = 1
        while True:
            params["page"] = page
            r = client.get(path, params=params)
            if r.status_code >= 400:
                raise ConnectorError(f"GitHub {path} failed: {r.status_code} {r.text[:200]}")
            batch = r.json()
            if not batch:
                break
            yield from batch
            if len(batch) < params["per_page"]:
                break
            page += 1

    def fetch_repos(self) -> Iterable[RepoDTO]:
        names = self.config.get("repos") or []
        if not names:
            raise ConnectorError("GitHub integration config missing 'repos' list.")
        out: list[RepoDTO] = []
        with self._client() as c:
            for full in names:
                r = c.get(f"/repos/{full}")
                if r.status_code >= 400:
                    raise ConnectorError(f"GitHub repo {full} failed: {r.status_code}")
                d = r.json()
                out.append(
                    RepoDTO(external_id=str(d["id"]), name=d["full_name"], url=d.get("html_url"))
                )
        return out

    @staticmethod
    def _identity(user: dict | None) -> IdentityDTO | None:
        if not user:
            return None
        return IdentityDTO(
            external_id=str(user.get("id") or user.get("login")),
            username=user.get("login"),
            display_name=user.get("login"),
        )

    def fetch_commits(self, repo: RepoDTO) -> Iterable[CommitDTO]:
        max_commits = int(self.config.get("max_commits", 300))
        out: list[CommitDTO] = []
        with self._client() as c:
            for item in self._paginate(c, f"/repos/{repo.name}/commits"):
                detail = c.get(f"/repos/{repo.name}/commits/{item['sha']}")
                stats = detail.json().get("stats", {}) if detail.status_code < 400 else {}
                files = detail.json().get("files", []) if detail.status_code < 400 else []
                commit_meta = item.get("commit", {})
                out.append(
                    CommitDTO(
                        sha=item["sha"],
                        author=self._identity(item.get("author"))
                        or IdentityDTO(
                            external_id=(commit_meta.get("author") or {}).get("email", "unknown"),
                            email=(commit_meta.get("author") or {}).get("email"),
                            display_name=(commit_meta.get("author") or {}).get("name"),
                        ),
                        authored_at=_parse_dt((commit_meta.get("author") or {}).get("date")),
                        additions=stats.get("additions", 0),
                        deletions=stats.get("deletions", 0),
                        files_changed=len(files),
                        message=commit_meta.get("message"),
                        is_merge=len(item.get("parents") or []) > 1,
                    )
                )
                if len(out) >= max_commits:
                    break
        return out

    def fetch_commit_diff(self, repo: RepoDTO, sha: str) -> CommitDiffDTO:
        with self._client() as c:
            r = c.get(f"/repos/{repo.name}/commits/{sha}")
            if r.status_code >= 400:
                raise ConnectorError(
                    f"GitHub commit {sha} failed: {r.status_code} {r.text[:200]}"
                )
            files = r.json().get("files", []) or []
        return CommitDiffDTO(
            sha=sha,
            files=[
                CommitFileDTO(
                    path=f.get("filename") or f.get("previous_filename") or "?",
                    status=f.get("status"),
                    additions=f.get("additions", 0),
                    deletions=f.get("deletions", 0),
                    patch=f.get("patch"),  # absent for binary/large files
                )
                for f in files
            ],
        )

    def fetch_pull_requests(self, repo: RepoDTO) -> Iterable[PullRequestDTO]:
        out: list[PullRequestDTO] = []
        with self._client() as c:
            for pr in self._paginate(
                c, f"/repos/{repo.name}/pulls", {"state": "all", "sort": "updated", "direction": "desc"}
            ):
                num = pr["number"]
                detail = c.get(f"/repos/{repo.name}/pulls/{num}").json()
                reviews = []
                rev_resp = c.get(f"/repos/{repo.name}/pulls/{num}/reviews")
                if rev_resp.status_code < 400:
                    for rev in rev_resp.json():
                        reviews.append(
                            ReviewDTO(
                                external_id=str(rev["id"]),
                                reviewer=self._identity(rev.get("user")),
                                state=(rev.get("state") or "").lower(),
                                submitted_at=_parse_dt(rev.get("submitted_at")),
                            )
                        )
                state = "merged" if pr.get("merged_at") else pr.get("state")
                out.append(
                    PullRequestDTO(
                        external_id=str(num),
                        title=pr.get("title"),
                        state=state,
                        author=self._identity(pr.get("user")),
                        additions=detail.get("additions", 0),
                        deletions=detail.get("deletions", 0),
                        changed_files=detail.get("changed_files", 0),
                        created_at=_parse_dt(pr.get("created_at")),
                        merged_at=_parse_dt(pr.get("merged_at")),
                        reviews=reviews,
                    )
                )
        return out
