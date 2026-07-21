"""Prepare a per-project working directory for the in-browser Claude terminal.

The terminal launches an interactive `claude` session with its cwd set to the
directory returned by :func:`prepare_workdir`. That directory holds a generated
``CLAUDE.md`` describing this project's id, the live Postgres schema, and how to
query it — so Claude can answer analytical questions about the project's data
straight away without the user having to explain the schema.

Guardrails: the terminal never receives the app's owner DB credentials. Instead
:func:`ensure_roles` provisions two least-privilege Postgres roles —

* ``report_ro``  — ``SELECT`` only (the default, pre-approved query path), and
* ``report_rw``  — ``SELECT`` + ``INSERT`` (no ``UPDATE``/``DELETE``/``TRUNCATE``),

so destructive and mutating statements are rejected by the database itself, not
merely discouraged in the prompt. Only the read-only connection is pre-approved
in the session's ``.claude/settings.json``; anything else prompts in the terminal.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Base, Project

# Root for the throwaway per-project scratch dirs. /tmp is writable and the
# contents are regenerated on every connect, so nothing here is durable state.
_WORKDIR_ROOT = Path(os.environ.get("CLAUDE_TERM_ROOT", "/tmp/claude-term"))

_ROLE_RO = "report_ro"
_ROLE_RW = "report_rw"

# Short human descriptions for the tables Claude will care about most. Anything
# not listed still appears in the auto-generated column dump below.
_TABLE_NOTES = {
    "projects": "one row per project; the project you are analysing is below",
    "integrations": "per-project connector config (jira/github/gitlab); tokens are encrypted",
    "members": "curated people",
    "project_members": "membership join; also holds per-member KPI JSON (kpi, kpi_status)",
    "member_identities": "external accounts (jira/github/gitlab) mapped to a curated member",
    "sprints": "agile sprints with state and start/end/complete dates",
    "tasks": "Jira issues: story_points, worklog_seconds, status_category, timestamps",
    "git_repos": "connected repositories; summary JSON is an LLM overview",
    "commits": "git commits with additions/deletions/files_changed and analysis JSON",
    "pull_requests": "PRs with state and created/merged timestamps",
    "pr_reviews": "PR review records",
    "deliverables": "deliverables with linked_task_keys and source (ai/manual)",
    "reports": "generated report artifacts (html_key/pdf_key point into object storage)",
    "story_point_scale": "per-project points -> time-band + risk reference",
    "sprint_member_capacity": "per-member focus factor (0.1-1.0) per sprint; allocated points = focus_factor * sprint working days",
    "sync_runs": "per-sync audit rows (status, stats JSON, error)",
}


def _role_password(role: str) -> str:
    """Stable per-role password derived from SECRET_KEY (hex, injection-safe)."""
    return hashlib.sha256(f"{settings.secret_key}:{role}".encode()).hexdigest()[:24]


def _base_dsn() -> tuple[str, int | None, str]:
    """(host, port, /dbname) parsed from the app's DATABASE_URL."""
    parts = urlsplit(settings.database_url.replace("+psycopg", "", 1))
    return parts.hostname or "db", parts.port, parts.path or "/reports"


def _role_url(role: str) -> str:
    host, port, dbname = _base_dsn()
    hostport = f"{host}:{port}" if port else host
    return f"postgresql://{role}:{_role_password(role)}@{hostport}{dbname}"


def ensure_roles(db: Session) -> None:
    """Idempotently provision the least-privilege analysis roles + grants.

    Safe to call on every terminal open: role creation is guarded by a pg_roles
    check and all grants are idempotent, so new tables from later migrations get
    picked up too.
    """
    for role in (_ROLE_RO, _ROLE_RW):
        pw = _role_password(role)  # hex only -> safe to inline in the DDL literal
        exists = db.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}
        ).scalar()
        if exists:
            db.execute(text(f"ALTER ROLE {role} WITH LOGIN PASSWORD '{pw}'"))
        else:
            db.execute(text(f"CREATE ROLE {role} WITH LOGIN PASSWORD '{pw}'"))

    both = f"{_ROLE_RO}, {_ROLE_RW}"
    db.execute(text(f"GRANT USAGE ON SCHEMA public TO {both}"))
    db.execute(text(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {both}"))
    db.execute(
        text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {both}")
    )
    # report_rw may additionally INSERT (needs sequence access for serial PKs).
    db.execute(text(f"GRANT INSERT ON ALL TABLES IN SCHEMA public TO {_ROLE_RW}"))
    db.execute(text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {_ROLE_RW}"))
    db.execute(
        text(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            f"GRANT INSERT ON TABLES TO {_ROLE_RW}"
        )
    )
    db.execute(
        text(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            f"GRANT USAGE, SELECT ON SEQUENCES TO {_ROLE_RW}"
        )
    )
    # Defensively ensure the mutating/destructive privileges are never present.
    db.execute(text(f"REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM {both}"))
    db.commit()


def _schema_summary() -> str:
    """Render the live table/column layout from the SQLAlchemy metadata.

    Generated from ``Base.metadata`` so it stays in sync with the models rather
    than being hand-maintained.
    """
    lines: list[str] = []
    for name in sorted(Base.metadata.tables):
        table = Base.metadata.tables[name]
        note = _TABLE_NOTES.get(name)
        header = f"### {name}"
        if note:
            header += f" — {note}"
        lines.append(header)
        cols = ", ".join(f"{c.name} ({c.type})" for c in table.columns)
        lines.append(cols)
        lines.append("")
    return "\n".join(lines).strip()


def _claude_md(project: Project) -> str:
    key_line = f" (key `{project.key}`)" if project.key else ""
    ro_url = _role_url(_ROLE_RO)
    rw_url = _role_url(_ROLE_RW)
    return f"""# Project data analysis — {project.name}{key_line}

You are an analyst helping explore data for **one specific project** in this app's
Postgres database.

- **Project id: `{project.id}`** — this project is `{project.name}`{key_line}.
- **Always scope your queries to `project_id = {project.id}`.** Rows for every project
  live in the same tables; forgetting the filter will mix projects together.

## Guardrails (important)

- This is a **read-only analysis** session. Use **`SELECT` only** on existing data.
- **Never** run `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, or `ALTER`. The read-only
  database role below physically rejects them, so don't waste a turn trying.
- If — and only if — the user explicitly asks you to **insert new rows**, use the
  separate read/write connection string further down; running it will require the
  user to approve the action. It permits `INSERT` but still forbids updates/deletes.

## Querying the database (read-only)

Use this connection string for all normal analysis. It can only read data:

```
{ro_url}
```

Example:

```
psql "{ro_url}" -c "select count(*) from tasks where project_id = {project.id};"
```

For Python, `psycopg` is installed — connect with the **same read-only string above**
(`import psycopg; psycopg.connect("{ro_url}")`).

## Inserting new data (requires the user's approval)

Only for explicit "insert …" requests. This role adds `INSERT` (no updates/deletes):

```
{rw_url}
```

## Schema

{_schema_summary()}

## Going deeper

The full application source is available at `/code`. For the exact aggregation logic
the app's reports use (per-member story points, hours, git contribution, flow metrics),
read `/code/app/services/metrics.py` — the `build_report_context()` function — and
`/code/app/models/entities.py` for authoritative column semantics and enums.
"""


def _allowed_tools() -> list[str]:
    """Pre-approved tools for the session.

    Only the read-only psql connection is whitelisted, so `SELECT` analysis runs
    without prompts while every other action — the read/write DB string, arbitrary
    bash, edits — still prompts in the terminal for the user to approve.
    """
    return [
        f'Bash(psql "{_role_url(_ROLE_RO)}":*)',
        "Read",
        "Grep",
        "Glob",
    ]


def prepare_workdir(project: Project, db: Session) -> str:
    """Provision roles, then create/refresh the project's scratch dir.

    Returns the directory path to use as the terminal process's cwd.
    """
    ensure_roles(db)

    workdir = _WORKDIR_ROOT / str(project.id)
    workdir.mkdir(parents=True, exist_ok=True)
    (workdir / "CLAUDE.md").write_text(_claude_md(project), encoding="utf-8")

    settings_dir = workdir / ".claude"
    settings_dir.mkdir(exist_ok=True)
    (settings_dir / "settings.json").write_text(
        json.dumps({"permissions": {"allow": _allowed_tools()}}, indent=2),
        encoding="utf-8",
    )
    return str(workdir)
