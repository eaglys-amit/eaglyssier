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
- **Portfolio** (`/portfolio`): every project you belong to on one screen — health
  (green/amber/red with the reasons), active sprint progress and scope change,
  velocity trend, next milestone and data freshness. Thresholds are constants at
  the top of `app/services/portfolio.py`.
- **Roadmap forecast**: each open milestone gets a P50/P85 finish window and the
  chance of making its target, from a Monte Carlo simulation over the last ≤8
  closed sprints' throughput (scaled by planned capacity when future sprints have
  it). Milestones are worked in roadmap order, so each forecast includes the work
  ahead of it. Health: on track ≥ 70% likely, at risk 30–70%, off track < 30%.
  With fewer than 3 closed sprints it falls back to a single low-confidence
  projection. See `app/services/forecast.py`.
- **Executive report**: pick "Executive summary" on the Reports tab for a short,
  outcome-first PDF for product leadership — health and its reasons, what
  shipped (in business language), the roadmap forecast, risks with mitigations
  and decisions needed. The prose comes from one call to the project's AI
  provider (`app/services/exec_report.py`); without it the report still renders
  from the data. A project can opt in to a weekly one (Mondays 00:30 UTC,
  covering the past 7 days) — this needs `RUN_SCHEDULER=true`, which the dev
  compose file turns off.
- **Specs** (spec-driven tracking, first slice): track an uploaded document as a
  spec on the Specs tab. Its requirements (keeping the document's own numbering,
  e.g. FR-001) are extracted by the project's AI provider, and each one is linked
  to the tasks that implement it. Its status comes from those tasks: untraced,
  planned, in progress, implemented. Uploading a revised document compares
  versions by each requirement's quoted source text, marks it new, changed or
  removed, and flags affected task links for review. See `app/services/specs.py`
  and `app/services/spec_diff.py`.
- **Repository specs** (spec-kit): turn a repository on in the Specs tab's
  "Specs in repositories" panel and every `specs/<feature>/` folder with a
  `spec.md` becomes a spec, re-read on each repo sync (`app/services/repo_specs.py`,
  parser in `app/services/speckit.py`). User stories (`### User Story 1 - …
  (Priority: P1)`, with their Given/When/Then scenarios) and keyed lines
  (`**FR-001**`, `NFR-`, `SC-`) become requirements; free-form files fall back to
  the AI. `tasks.md` lines (`- [ ] T012 [US1] …`) are matched to existing tracker
  tasks — never created — and linked to the stories and FR keys they name.
  Unlinked commits whose message names a task id (T012) or requirement key
  (FR-003) that resolves to exactly one task get linked to it. Repo specs are
  read-only here; change them in the repository.
- **Automatic requirement links**:
  - *AI breakdown* — when a breakdown's documents are tracked specs, the model
    tags each proposed task with the requirement keys it implements; the draft
    shows which requirements no node covers, and creating the tasks links them.
  - *Key scan* — tasks whose title, description or acceptance criteria cite a
    requirement key (FR-001, REQ-12) are linked. Runs after every Jira sync and
    spec update, and from "Scan tickets for keys" on the Specs tab. Only keys
    unique across the project's specs are used.
  - *Review queue* — the Specs tab lists every link whose requirement changed or
    was removed since it was made, with "Still fits" / "Unlink".
- Email + password login with a role per project (see [Users & roles](#users--roles)).

## Quick start

```bash
cp .env.example .env          # adjust secrets if you like
docker compose up --build     # starts db, rustfs, app (migrations run on boot)
```

Open http://localhost:8000 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from
`.env` (that admin is created on first boot, while no user exists) → the **Projects** dashboard (the image builds and
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

## Users & roles

Everyone signs in. A **user** (login) is linked to a curated **member**, and the
member's role on each project decides what that user can do there:

| | VP of Product | Tech Lead | Project Manager | Developer |
|---|---|---|---|---|
| Read project data, roadmap, scrums, docs, reports | ✓ | ✓ | ✓ | ✓ |
| Generate reports; edit milestones | ✓ | ✓ | ✓ | |
| Backlog tasks | | ✓ | ✓ | ✓ |
| Sprints, capacity, epics, breakdowns, SP scale | | ✓ | ✓ | |
| Evaluation sheets & KPIs | | all members | all members | own only |
| Sync, commit analysis, repo docs | | ✓ | ✓ | |
| Project membership & roles | | | ✓ | |
| Terminal | | ✓ | | |

Evaluation fields follow the same split: the member fills in goals and their
self-grade, the tech lead grades, the project manager sets the final grade.

**Admin** is a separate flag, independent of project roles: it manages users
(the **Users** page), integrations, the Claude provider, and creates/deletes
projects, and passes every check. Only projects you are a member of are listed
(admins see all); the Users page can add someone to every project at once.

The policy lives in one place, `app/api/authz.py` (`POLICY` maps each route to
a capability, `ROLE_CAPS` maps roles to capabilities), mirrored for the UI in
`frontend/src/lib/permissions.ts`. Command-line user management:

```bash
docker compose exec app python scripts/create_user.py someone@example.com [--admin] [--member-email someone@example.com]
```

The demo seed creates `vp@`, `pm@`, `alice@` (tech lead) and `bob@` (developer)
`demo.dev` logins with password `demo-password`.

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

Tests: `uv run pytest` (in-memory SQLite by default; set `TEST_DATABASE_URL` to an
empty Postgres database to run against Postgres).
