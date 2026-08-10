"""Jira connector (Cloud REST v3 + Agile v1.0).

Config keys:
  email               -> Atlassian account email (basic-auth username)
  board_id            -> Agile board id to read sprints from
  project_key         -> Jira project key (JQL filter for issues)
  story_points_field  -> custom field id for story points (default customfield_10016)
Credentials blob: the Atlassian API token.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime

import httpx

from app.connectors.base import ConnectorError, IssueTrackerConnector
from app.connectors.dto import IdentityDTO, SprintDTO, TaskDTO
from app.models import IntegrationType

_STATUS_CATEGORY_MAP = {"new": "todo", "indeterminate": "in_progress", "done": "done"}


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_date(value: str | None) -> date | None:
    dt = _parse_dt(value)
    return dt.date() if dt else None


# Block-level ADF nodes after which we emit a line break.
_ADF_BLOCKS = {"paragraph", "heading", "listItem", "blockquote", "codeBlock"}


def _adf_to_text(node) -> str:
    """Flatten Jira's Atlassian Document Format description JSON to plain text."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(_adf_to_text(n) for n in node)
    if not isinstance(node, dict):
        return ""
    ntype = node.get("type")
    if ntype == "text":
        return node.get("text", "")
    if ntype == "hardBreak":
        return "\n"
    inner = _adf_to_text(node.get("content", []))
    if ntype in _ADF_BLOCKS:
        return inner + "\n"
    return inner


class JiraConnector(IssueTrackerConnector):
    kind = IntegrationType.jira

    def _client(self) -> httpx.Client:
        email = self.config.get("email")
        missing = []
        if not self.base_url:
            missing.append("base_url")
        if not email:
            missing.append('config.email (your Atlassian account email, e.g. {"email": "you@org.com"})')
        if not self.token:
            missing.append("API token")
        if missing:
            raise ConnectorError("Jira integration is missing: " + "; ".join(missing))
        return httpx.Client(
            base_url=self.base_url,
            auth=(email, self.token),
            headers={"Accept": "application/json"},
            timeout=30.0,
        )

    @property
    def _board_id(self) -> str:
        board = self.config.get("board_id")
        if not board:
            raise ConnectorError("Jira integration config missing 'board_id'.")
        return str(board)

    def test_connection(self) -> bool:
        with self._client() as c:
            r = c.get("/rest/api/3/myself")
            return r.status_code == 200

    def fetch_sprints(self) -> Iterable[SprintDTO]:
        out: list[SprintDTO] = []
        with self._client() as c:
            start = 0
            while True:
                r = c.get(
                    f"/rest/agile/1.0/board/{self._board_id}/sprint",
                    params={"startAt": start, "maxResults": 50},
                )
                if r.status_code >= 400:
                    raise ConnectorError(f"Jira sprints failed: {r.status_code} {r.text[:200]}")
                data = r.json()
                for s in data.get("values", []):
                    out.append(
                        SprintDTO(
                            external_id=str(s["id"]),
                            name=s.get("name", f"Sprint {s['id']}"),
                            state=s.get("state"),
                            start_date=_parse_date(s.get("startDate")),
                            end_date=_parse_date(s.get("endDate")),
                            complete_date=_parse_date(s.get("completeDate")),
                            goal=s.get("goal"),
                        )
                    )
                if data.get("isLast", True):
                    break
                start += len(data.get("values", [])) or 50
        return out

    def fetch_tasks(self) -> Iterable[TaskDTO]:
        sp_field = self.config.get("story_points_field", "customfield_10016")
        project_key = self.config.get("project_key")
        jql = f"project = {project_key} ORDER BY updated DESC" if project_key else "ORDER BY updated DESC"
        # The epic-link custom field, for company-managed projects that predate
        # Jira unifying it onto `parent`. Configurable because its id differs
        # per site; the default is Jira's classic "Epic Link".
        epic_field = self.config.get("epic_link_field", "customfield_10014")
        fields = [
            "summary", "description", "issuetype", "status", "assignee",
            "created", "updated", "resolutiondate", "aggregatetimespent",
            "customfield_10020",  # sprint field (Jira default)
            # Hierarchy: `parent` covers both a subtask's parent and, on
            # team-managed projects, a story's epic. Without it every synced
            # subtask lands orphaned and the breakdown tree is flat.
            "parent",
            epic_field,
            sp_field,
        ]
        out: list[TaskDTO] = []
        with self._client() as c:
            cat_map = self._status_category_map(c)
            # New enhanced-search endpoint: token-based pagination (the old
            # /rest/api/3/search with startAt/total was removed -> HTTP 410).
            # expand=changelog gives status-transition history for cycle time.
            next_token: str | None = None
            while True:
                params = {
                    "jql": jql, "maxResults": 100, "fields": ",".join(fields), "expand": "changelog",
                }
                if next_token:
                    params["nextPageToken"] = next_token
                r = c.get("/rest/api/3/search/jql", params=params)
                if r.status_code >= 400:
                    raise ConnectorError(f"Jira issues failed: {r.status_code} {r.text[:200]}")
                data = r.json()
                for issue in data.get("issues", []):
                    out.append(self._issue_to_dto(issue, sp_field, cat_map, epic_field))
                next_token = data.get("nextPageToken")
                if data.get("isLast") or not next_token or not data.get("issues"):
                    break
        return out

    def _status_category_map(self, client: httpx.Client) -> dict[str, str]:
        """Map status name (lowercased) -> our category (todo/in_progress/done)."""
        try:
            r = client.get("/rest/api/3/status")
            if r.status_code >= 400:
                return {}
            out: dict[str, str] = {}
            for s in r.json():
                key = (s.get("statusCategory") or {}).get("key", "new")
                out[(s.get("name") or "").lower()] = _STATUS_CATEGORY_MAP.get(key, "todo")
            return out
        except Exception:  # noqa: BLE001 - changelog is best-effort
            return {}

    @staticmethod
    def _first_in_progress(changelog: dict, cat_map: dict[str, str]) -> datetime | None:
        """Earliest timestamp the issue transitioned into an in-progress status."""
        histories = (changelog or {}).get("histories", []) or []
        stamps: list[datetime] = []
        for h in histories:
            when = _parse_dt(h.get("created"))
            if not when:
                continue
            for item in h.get("items", []):
                if item.get("field") == "status":
                    to_name = (item.get("toString") or "").lower()
                    if cat_map.get(to_name) == "in_progress":
                        stamps.append(when)
        return min(stamps) if stamps else None

    @staticmethod
    def _parent_key(f: dict, epic_field: str) -> str | None:
        """The issue this one hangs off, as a Jira key.

        Two shapes, because Jira changed how hierarchy is modelled and both are
        still in the wild:

        * ``parent`` — a subtask's parent everywhere, and on team-managed
          projects also a story's epic. An object with a ``key``.
        * the Epic Link custom field — company-managed projects that predate the
          unification. A bare key string, not an object.

        ``parent`` wins when both are present: it is the modern field and the
        one Jira keeps current.
        """
        parent = f.get("parent")
        if isinstance(parent, dict) and parent.get("key"):
            return str(parent["key"])
        epic = f.get(epic_field)
        if isinstance(epic, str) and epic.strip():
            return epic.strip()
        # Some sites return the epic link as an object too.
        if isinstance(epic, dict) and epic.get("key"):
            return str(epic["key"])
        return None

    def _issue_to_dto(
        self,
        issue: dict,
        sp_field: str,
        cat_map: dict[str, str] | None = None,
        epic_field: str = "customfield_10014",
    ) -> TaskDTO:
        f = issue.get("fields", {})
        status = f.get("status") or {}
        cat_key = (status.get("statusCategory") or {}).get("key", "new")
        assignee = None
        a = f.get("assignee")
        if a:
            assignee = IdentityDTO(
                external_id=a.get("accountId") or a.get("emailAddress") or a.get("displayName"),
                email=a.get("emailAddress"),
                display_name=a.get("displayName"),
            )
        # Sprint: Jira returns a list on customfield_10020; take the last (current) sprint.
        sprint_ext = None
        sprints = f.get("customfield_10020")
        if isinstance(sprints, list) and sprints:
            last = sprints[-1]
            sprint_ext = str(last.get("id")) if isinstance(last, dict) else None

        return TaskDTO(
            external_key=issue["key"],
            title=f.get("summary", issue["key"]),
            description=_adf_to_text(f.get("description")).strip() or None,
            issue_type=(f.get("issuetype") or {}).get("name"),
            status=status.get("name"),
            status_category=_STATUS_CATEGORY_MAP.get(cat_key, "todo"),
            story_points=f.get(sp_field),
            worklog_seconds=f.get("aggregatetimespent") or 0,
            parent_external_key=self._parent_key(f, epic_field),
            sprint_external_id=sprint_ext,
            assignee=assignee,
            created_at=_parse_dt(f.get("created")),
            updated_at=_parse_dt(f.get("updated")),
            started_at=self._first_in_progress(issue.get("changelog", {}), cat_map or {}),
            resolved_at=_parse_dt(f.get("resolutiondate")),
        )
