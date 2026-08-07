# Eaglyssier

**Eaglyssier** — the complete file on every project. Generates software-project
reports — sprint analytics, per-member story-point assigned-vs-completed, working
hours, git contribution, and deliverables — as HTML and PDF, stored in object
storage.

**Stack:** FastAPI (JSON API) · React + Vite + TypeScript + Tailwind + shadcn/ui (SPA)
· PostgreSQL · RustFS (S3-compatible) · WeasyPrint (PDF, Jinja2) · Docker Compose
· `uv` (packaging) · Python 3.12.

## Iteration 1 scope

- Multiple projects, each connected to integrations.
- **Jira** (sprints, tasks, story points, worklogs) and **Git — GitHub + GitLab**
  (commits, PRs, reviews per member). Slack + Google Workspace are stubbed.
- Identity reconciliation: one Member per person, linking Jira/GitHub/GitLab accounts.
- Sprint & project reports with reusable, componentized templates → HTML + PDF in RustFS.
- No authentication (internal tool).

## Quick start

```bash
cp .env.example .env          # adjust secrets if you like
docker compose up --build     # starts db, rustfs, app (migrations run on boot)
```

Open http://localhost:8000 → the **Projects** dashboard (the image builds and
serves the React SPA; no Node needed on the host).

### Try it with demo data (no live credentials needed)

```bash
docker compose exec app python scripts/seed_demo.py
```

Then in the UI: open **Demo Platform → Generate report → Sprint 7 → Generate**, and
**View** / **PDF** the result.

### Connect real data

On a project's **Integrations** tab, connect a platform:

- **Jira** — Base URL `https://your-org.atlassian.net`, API token + account email,
  project key, optional board ID and story-points field (`customfield_10016`).
- **GitHub** — token plus an owner (org or user), then **Fetch repositories** and
  tick the ones to analyze. (Base URL only for GitHub Enterprise.)
- **GitLab** — token plus a group or user namespace, then **Fetch projects** and
  tick the ones to analyze. (Base URL for self-hosted, else defaults to gitlab.com.)

Re-open **Edit** any time and hit **Refresh** to re-list and change the selection;
the saved token is reused, so it does not need retyping.

Click **Sync** on the Data tab, reconcile any identities under **Members**, then
generate a report. A background scheduler also re-syncs enabled integrations every
`SYNC_INTERVAL_MINUTES`.

## Per-commit code analysis (LLM)

On a project's **Data** tab, each commit can be analyzed to produce a plain-language
list of *what was done*, alongside its contributor. Use **Analyze** per commit or
**Analyze all commits** per repo. The provider and model are chosen per project
on the **Provider** tab.

This iteration ships the **Claude Code CLI** provider (local, runs inside the app
container). The Claude API / OpenAI / Gemini options are wired in the UI but not yet
implemented. Diffs are fetched on demand from the repo's existing integration token.

**One-time Claude login** (a long-lived OAuth token, valid ~1 year):

```bash
docker compose build                             # installs Node + @anthropic-ai/claude-code
docker compose run --rm app claude setup-token   # complete the OAuth flow once
```

`setup-token` prints an `sk-ant-oat01-…` token (shown once, not stored anywhere by
the CLI). Either paste it into the **Provider tab** in the UI — it's saved in the
`claude_config` volume and survives `docker compose down` (but not `down -v`) — or
put it in `.env` as `CLAUDE_CODE_OAUTH_TOKEN=…` and `docker compose up -d app`.

The token uses your Claude subscription — no API key required. Relevant env (see
`.env.example`): `DEFAULT_ANALYSIS_PROVIDER`, `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_MODEL`, `CLAUDE_TIMEOUT_SECONDS`, `CLAUDE_MAX_DIFF_BYTES`.

## Architecture

```
app/
  api/          JSON API (/api/...) consumed by the SPA
  connectors/   jira, github, gitlab (+ slack/google stubs) -> normalized DTOs
  services/     sync, identity, metrics, reports, crypto
  models/       SQLAlchemy 2.0 entities
  schemas/      Pydantic response/request models (+ report.py: PDF context)
  reporting/    charts.py (SVG) + Jinja templates (base, macros, sections, reports)
  web/          non-API routes: report artifacts (/reports/{id}/view|pdf) and
                the two PTY WebSockets (Claude login + per-project terminal)
  storage/      RustFS (S3) wrapper
frontend/       React + Vite + TS + Tailwind v4 + shadcn/ui SPA (builds to dist/)
```

- **UI**: a single-page app served by FastAPI (`frontend/dist`, SPA fallback on
  unknown paths). All data flows through `/api/...`; background jobs (sync, LLM
  analysis, KPIs, reports) are polled every 2s while running.
- **Reports/PDF**: unchanged Jinja pipeline — reports compose reusable
  `sections/` from shared `macros/` on `base.html.j2`, rendered to stored HTML
  and a WeasyPrint PDF. Adding a report type is a small template, not new markup.
- **Terminals**: the Provider tab's Claude login and the per-project Terminal tab
  are xterm.js clients on PTY-backed WebSockets (paths unchanged, outside /api).

## Development

Backend (API on :8000):

```bash
uv sync                       # create local venv from pyproject
uv run uvicorn app.main:app --reload
# or: docker compose up  (bind-mounts the repo, --reload watches app/)
```

Frontend (Vite dev server on :5173, proxies /api + report artifacts + terminal
WebSockets to :8000):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 during development (hot reload). Or run everything in
Docker: `docker compose --profile dev up` and use the `web` service on :5173.

Production build: `cd frontend && npm run build` writes `frontend/dist`, which
FastAPI serves at `/` (the Docker image does this in a multi-stage build). Without
a build, unknown paths return a 503 hint — the API itself works fine.

Migrations: `uv run alembic revision --autogenerate -m "msg"` then `alembic upgrade head`.
