"""Who may call what: login check, per-project roles and the route policy.

Enforcement is centralized rather than sprinkled over ~200 handlers. Every
/api route runs `authorize` (installed on the router in app.api), which

1. finds the project the request touches — from `project_id`, or by loading
   the entity behind `task_id`, `repo_id`, `session_id`, ... (`_RESOLVERS`);
2. looks up the capability the route needs in `POLICY` (first match wins);
3. checks the caller's role on that project grants it (`ROLE_CAPS`).

Handlers that filter rows by person (evaluations, KPIs) read the resulting
`Access` via `Depends(get_access)`. Admins pass every check.

The frontend mirrors ROLE_CAPS in src/lib/permissions.ts to hide what a user
cannot do; this module stays the enforcer.
"""
from __future__ import annotations

import enum
from collections.abc import Callable
from dataclasses import dataclass
from fnmatch import fnmatchcase

from fastapi import Depends, HTTPException, Request, WebSocket
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Commit,
    GitRepo,
    Integration,
    MemberIdentity,
    Milestone,
    PokerRound,
    PokerSession,
    Project,
    ProjectMember,
    ProjectRole,
    ReferenceFile,
    RepoDoc,
    Report,
    Sprint,
    Task,
    TaskBreakdown,
    User,
)
from app.services import auth as auth_svc


class Cap(str, enum.Enum):
    # Not tied to a project.
    AUTH = "auth"                    # any logged-in user
    ADMIN = "admin"                  # users, integrations, provider, project create/delete
    # Granted per project by role.
    VIEW = "view"                    # read project data, roadmap, scrums, docs, reports
    REPORT = "report"                # generate/delete reports and deliverables
    ROADMAP = "roadmap"              # milestones: create, edit, link tasks
    TASK = "task"                    # create/edit/delete backlog tasks
    PLAN = "plan"                    # sprints, capacity, ranking, epics, breakdowns, SP scale
    POKER_VOTE = "poker_vote"
    POKER_FACILITATE = "poker_facilitate"
    PEOPLE = "people"                # evaluation sheets, KPIs, member scope (own only for devs)
    PEOPLE_MANAGE = "people_manage"  # run KPI generation, change member analysis scope
    MEMBERS = "members"              # project membership, roles, identity mapping
    OPS = "ops"                      # sync, commit analysis/linking, repo docs
    DOCS = "docs"                    # reference document uploads and folders
    TERMINAL = "terminal"            # per-project Claude terminal


# Developers hold PEOPLE only for themselves; see `Access.sees_all_people`.
ROLE_CAPS: dict[str, frozenset[Cap]] = {
    ProjectRole.vp_product.value: frozenset({
        Cap.VIEW, Cap.REPORT, Cap.ROADMAP, Cap.POKER_VOTE, Cap.DOCS,
    }),
    ProjectRole.tech_lead.value: frozenset({
        Cap.VIEW, Cap.REPORT, Cap.ROADMAP, Cap.TASK, Cap.PLAN, Cap.POKER_VOTE,
        Cap.POKER_FACILITATE, Cap.PEOPLE, Cap.PEOPLE_MANAGE, Cap.OPS, Cap.DOCS,
        Cap.TERMINAL,
    }),
    ProjectRole.project_manager.value: frozenset({
        Cap.VIEW, Cap.REPORT, Cap.ROADMAP, Cap.TASK, Cap.PLAN, Cap.POKER_VOTE,
        Cap.POKER_FACILITATE, Cap.PEOPLE, Cap.PEOPLE_MANAGE, Cap.MEMBERS, Cap.OPS,
        Cap.DOCS,
    }),
    ProjectRole.developer.value: frozenset({
        Cap.VIEW, Cap.TASK, Cap.POKER_VOTE, Cap.PEOPLE,
    }),
}

_SEES_ALL_PEOPLE = {ProjectRole.tech_lead.value, ProjectRole.project_manager.value}


# "METHOD /path" glob (route templates, without the /api prefix) -> capability.
# First match wins: the reads that are *not* plain project views come first,
# then every other GET is VIEW, then the writes. Every route must match a rule;
# tests/test_authz.py fails on any that falls through.
POLICY: list[tuple[str, Cap]] = [
    # --- reads with their own rule ---
    ("GET /projects", Cap.AUTH),
    ("GET /portfolio", Cap.AUTH),           # filtered to the caller's projects
    ("GET /members", Cap.AUTH),
    ("GET /provider/claude/status", Cap.AUTH),
    ("GET /users*", Cap.ADMIN),
    ("GET /projects/{project_id}/kpi", Cap.PEOPLE),
    ("GET /projects/{project_id}/evaluation*", Cap.PEOPLE),
    ("GET /projects/{project_id}/members/{member_id}/scope", Cap.PEOPLE),
    ("GET /projects/{project_id}/members/sync-preview", Cap.MEMBERS),
    ("GET /*", Cap.VIEW),
    # --- global writes ---
    ("POST /projects", Cap.ADMIN),
    ("DELETE /projects/{project_id}", Cap.ADMIN),
    ("PATCH /projects/{project_id}", Cap.PLAN),
    ("* /members*", Cap.ADMIN),
    ("* /provider/*", Cap.ADMIN),
    ("* /users*", Cap.ADMIN),
    # --- integrations & sync ---
    ("POST /integrations/{integration_id}/sync", Cap.OPS),
    ("* /projects/{project_id}/integrations/*", Cap.ADMIN),
    ("* /integrations/*", Cap.ADMIN),
    ("POST /repos/{repo_id}/sync", Cap.OPS),
    ("POST /projects/{project_id}/repos/sync", Cap.OPS),
    # --- people: evaluations, KPIs, per-member scope ---
    ("POST /projects/{project_id}/kpi", Cap.PEOPLE_MANAGE),
    ("* /projects/{project_id}/evaluation/*", Cap.PEOPLE),
    ("PUT /projects/{project_id}/members/{member_id}/scope", Cap.PEOPLE_MANAGE),
    # --- membership ---
    ("* /projects/{project_id}/members*", Cap.MEMBERS),
    ("* /projects/{project_id}/identities/*", Cap.MEMBERS),
    # --- roadmap ---
    ("* /projects/{project_id}/milestones*", Cap.ROADMAP),
    # --- poker ---
    ("POST /poker/rounds/{round_id}/vote", Cap.POKER_VOTE),
    ("* /projects/{project_id}/poker", Cap.POKER_FACILITATE),
    ("* /poker/*", Cap.POKER_FACILITATE),
    # --- reports & deliverables ---
    ("POST /projects/{project_id}/reports", Cap.REPORT),
    ("PUT /projects/{project_id}/reports/executive-schedule", Cap.REPORT),
    ("DELETE /reports/{report_id}", Cap.REPORT),
    ("POST /projects/{project_id}/deliverables/*", Cap.REPORT),
    # --- backlog / scrum ---
    ("POST /projects/{project_id}/tasks/bulk-move", Cap.PLAN),
    ("POST /tasks/{task_id}/rank", Cap.PLAN),
    ("POST /projects/{project_id}/tasks", Cap.TASK),
    ("* /tasks/*", Cap.TASK),
    ("* /projects/{project_id}/sprints*", Cap.PLAN),
    ("DELETE /sprints/{sprint_id}", Cap.PLAN),
    ("DELETE /projects/{project_id}/backlog", Cap.PLAN),
    ("* /projects/{project_id}/story-points*", Cap.PLAN),
    ("* /projects/{project_id}/epics/*", Cap.PLAN),
    ("* /projects/{project_id}/breakdowns", Cap.PLAN),
    ("* /breakdowns/*", Cap.PLAN),
    # --- data operations ---
    ("* /commits/*", Cap.OPS),
    ("* /projects/{project_id}/link-commits*", Cap.OPS),
    ("* /repos/*", Cap.OPS),
    ("* /repo-docs/*", Cap.OPS),
    # --- reference documents ---
    ("* /references/*", Cap.DOCS),
    ("* /projects/{project_id}/references", Cap.DOCS),
    ("* /projects/{project_id}/reference-folders*", Cap.DOCS),
]


def rule_for(method: str, path: str) -> Cap | None:
    """The capability a route needs, or None when no rule covers it."""
    key = f"{method} {path}"
    return next((cap for pattern, cap in POLICY if fnmatchcase(key, pattern)), None)


# Path param -> project of the entity it names. `member_id` (a global person)
# and `folder_id` (two different tables) are left to the handlers.
def _via_repo(model, attr: str) -> Callable[[Session, int], int | None]:
    def resolve(db: Session, obj_id: int) -> int | None:
        repo_id = db.execute(select(getattr(model, attr)).where(model.id == obj_id)).scalar()
        return db.execute(select(GitRepo.project_id).where(GitRepo.id == repo_id)).scalar()
    return resolve


def _direct(model) -> Callable[[Session, int], int | None]:
    return lambda db, obj_id: db.execute(
        select(model.project_id).where(model.id == obj_id)
    ).scalar()


def _round_project(db: Session, round_id: int) -> int | None:
    return db.execute(
        select(PokerSession.project_id)
        .join(PokerRound, PokerRound.session_id == PokerSession.id)
        .where(PokerRound.id == round_id)
    ).scalar()


_RESOLVERS: dict[str, Callable[[Session, int], int | None]] = {
    "project_id": lambda db, pid: pid if db.get(Project, pid) else None,
    "task_id": _direct(Task),
    "sprint_id": _direct(Sprint),
    "milestone_id": _direct(Milestone),
    "repo_id": _direct(GitRepo),
    "integration_id": _direct(Integration),
    "report_id": _direct(Report),
    "breakdown_id": _direct(TaskBreakdown),
    "file_id": _direct(ReferenceFile),
    "session_id": _direct(PokerSession),
    "identity_id": _direct(MemberIdentity),
    "round_id": _round_project,
    "commit_id": _via_repo(Commit, "repo_id"),
    "doc_id": _via_repo(RepoDoc, "repo_id"),
}


@dataclass(frozen=True)
class Access:
    user: User
    project_id: int | None = None
    role: str | None = None

    @property
    def is_admin(self) -> bool:
        return self.user.is_admin

    @property
    def member_id(self) -> int | None:
        return self.user.member_id

    @property
    def sees_all_people(self) -> bool:
        """False for developers: evaluation/KPI rows are limited to their own."""
        return self.is_admin or self.role in _SEES_ALL_PEOPLE

    def can(self, cap: Cap) -> bool:
        if cap is Cap.AUTH or self.is_admin:
            return True
        return self.role is not None and cap in ROLE_CAPS.get(self.role, frozenset())

    def require_person(self, member_id: int) -> None:
        """403 unless the caller may see/edit this member's people data."""
        if not self.sees_all_people and member_id != self.member_id:
            raise HTTPException(403, "You can only access your own records")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = auth_svc.resolve_session(db, request.cookies.get(auth_svc.SESSION_COOKIE))
    if user is None:
        raise HTTPException(401, "Not logged in")
    request.state.user = user
    return user


def project_role(db: Session, user: User, project_id: int) -> str | None:
    if user.member_id is None:
        return None
    return db.execute(
        select(ProjectMember.role).where(
            ProjectMember.project_id == project_id,
            ProjectMember.member_id == user.member_id,
        )
    ).scalar()


def memberships(db: Session, user: User) -> dict[int, str]:
    """project_id -> role for every project the user belongs to."""
    if user.member_id is None:
        return {}
    return dict(db.execute(
        select(ProjectMember.project_id, ProjectMember.role)
        .where(ProjectMember.member_id == user.member_id)
    ).all())


def _resolve_project(db: Session, params: dict[str, str]) -> int | None:
    found: set[int] = set()
    for name, raw in params.items():
        resolver = _RESOLVERS.get(name)
        if resolver is None:
            continue
        try:
            obj_id = int(raw)
        except ValueError:
            continue
        pid = resolver(db, obj_id)
        if pid is None:
            # Unknown entity: let the handler produce its usual 404.
            continue
        found.add(pid)
    if len(found) > 1:
        # e.g. /projects/1/milestones/<milestone of project 2>.
        raise HTTPException(404, "Not found")
    return found.pop() if found else None


def authorize(
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Access:
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    cap = rule_for(request.method, path)
    if cap is None:
        # Fail closed: a route nobody wrote a rule for is admin-only.
        cap = Cap.ADMIN

    project_id = _resolve_project(db, request.path_params)
    role = project_role(db, user, project_id) if project_id is not None else None
    access = Access(user=user, project_id=project_id, role=role)
    request.state.access = access

    if cap is Cap.AUTH or user.is_admin:
        return access
    if cap is Cap.ADMIN:
        raise HTTPException(403, "Admin only")
    if project_id is None:
        # Project-scoped capability but nothing resolved: the target doesn't exist.
        raise HTTPException(404, "Not found")
    if role is None:
        raise HTTPException(404, "Project not found")
    if not access.can(cap):
        raise HTTPException(403, "Your role on this project does not allow this")
    if cap is Cap.PEOPLE and "member_id" in request.path_params:
        access.require_person(int(request.path_params["member_id"]))
    return access


def get_access(request: Request) -> Access:
    """The `Access` computed by `authorize` for this request."""
    return request.state.access


async def authorize_websocket(ws: WebSocket, cap: Cap, project_id: int | None = None) -> bool:
    """Cookie check for the PTY WebSockets, which `authorize` can't serve.

    Call before `ws.accept()`; on refusal the handshake is closed (4401 not
    logged in, 4403 forbidden) and False is returned.
    """
    db = next(get_db())
    try:
        user = auth_svc.resolve_session(db, ws.cookies.get(auth_svc.SESSION_COOKIE))
        if user is None:
            code = 4401
        else:
            role = project_role(db, user, project_id) if project_id is not None else None
            allowed = Access(user=user, project_id=project_id, role=role).can(cap)
            code = None if allowed else 4403
    finally:
        db.close()
    if code is not None:
        await ws.close(code=code)
        return False
    return True
