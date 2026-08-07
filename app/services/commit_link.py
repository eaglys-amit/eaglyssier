"""LLM attribution of git commits to Jira tasks.

A commit that carries no Jira key is matched to the task it most likely
implements: the commit's date selects the sprint whose window contains it, and
the provider (see app.services.analyzers) is asked to pick the best-matching task
from that sprint by comparing the commit's analysis summary against task titles
and descriptions. The resulting link is persisted on ``Commit.linked_task_id``.

Attribution runs as a queue: enqueued commits sit at ``link_status='queued'``,
a single per-project drain worker claims them one at a time to ``'running'`` and
processes them. Both queued and running commits can be cancelled cooperatively
(``queued`` -> removed from the queue; ``running`` -> aborted at the next
checkpoint — an in-flight model call finishes but its result is discarded).
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Commit, GitRepo, MemberIdentity, Sprint, Task
from app.services import analyzers
from app.services.commit_analysis import analyze_commit

_MAX_CANDIDATES = 40
_MAX_DESC = 300

# One drain worker per project (best-effort; correctness comes from the atomic
# claim below). Plus the set of running commits a user asked to cancel.
_worker_lock = threading.Lock()
_active_projects: set[int] = set()
_cancel_lock = threading.Lock()
_cancelled: set[int] = set()

_PROMPT = """\
You are attributing a single git commit to the Jira task it most likely implements.

Commit summary: {summary}
Commit message: {message}

Candidate Jira tasks (all from the sprint active on the commit's date):
{candidates}

Pick the ONE task this commit most plausibly belongs to by comparing the commit's \
intent to each task's title and description. If none clearly match, return null.

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"task_key": "ABC-123", "reason": "one short sentence"}}
Use null for task_key when there is no clear match.
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _mark_cancelled(commit_id: int) -> None:
    with _cancel_lock:
        _cancelled.add(commit_id)


def _take_cancelled(commit_id: int) -> bool:
    """Consume a pending cancel request for a commit (True if one was set)."""
    with _cancel_lock:
        if commit_id in _cancelled:
            _cancelled.discard(commit_id)
            return True
        return False


def _clear_cancelled(commit_id: int) -> None:
    """Drop any residual cancel flag once a commit has finished processing.

    Guards against a Stop that raced a just-completing run leaving a stale flag
    that would otherwise abort the commit's next attribution attempt.
    """
    with _cancel_lock:
        _cancelled.discard(commit_id)


def _commit_summary(commit: Commit) -> str | None:
    analysis = commit.analysis if isinstance(commit.analysis, dict) else {}
    summary = analysis.get("summary")
    if summary:
        return summary
    if commit.message:
        lines = commit.message.strip().splitlines()
        if lines:
            return lines[0][:200]
    return None


def _sprint_for(db: Session, project_id: int, when: datetime) -> Sprint | None:
    """The sprint whose [start_date, end_date] window contains ``when``."""
    day = when.date()
    return db.execute(
        select(Sprint)
        .where(
            Sprint.project_id == project_id,
            Sprint.start_date.is_not(None),
            Sprint.end_date.is_not(None),
            Sprint.start_date <= day,
            Sprint.end_date >= day,
        )
        .order_by(Sprint.start_date.desc())
    ).scalars().first()


def _member_tasks(db: Session, project_id: int, member_id: int) -> list[Task]:
    """All tasks in the project assigned to a given member."""
    return list(
        db.execute(
            select(Task)
            .join(MemberIdentity, Task.assignee_identity_id == MemberIdentity.id)
            .where(Task.project_id == project_id, MemberIdentity.member_id == member_id)
            .order_by(Task.external_key)
        ).scalars().all()
    )


def _window_contains(task: Task, when: datetime) -> bool:
    """True if the task was actively being worked on at ``when``.

    Window = [started_at_src or created_at_src, resolved_at_src or open]. This
    spans sprints, so a task carried A->B is matched by commits from either.
    """
    start = task.started_at_src or task.created_at_src
    if start is None:
        return False
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if when < start:
        return False
    end = task.resolved_at_src
    if end is not None:
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if when > end:
            return False
    return True


def _auto_candidates(db: Session, project_id: int, member_id: int, when: datetime) -> list[Task]:
    """Member tasks a commit could belong to: in the covering sprint, or whose
    active window contains the commit date (handles carry-over across sprints)."""
    sprint = _sprint_for(db, project_id, when)
    cov_id = sprint.id if sprint else None
    tasks = _member_tasks(db, project_id, member_id)
    picked = [
        t for t in tasks if (cov_id is not None and t.sprint_id == cov_id) or _window_contains(t, when)
    ]
    return picked[:_MAX_CANDIDATES]


def _abort(db: Session, commit: Commit) -> None:
    """Roll a cancelled commit back to an idle (re-runnable) state."""
    db.rollback()
    fresh = db.get(Commit, commit.id)
    if fresh is not None:
        fresh.link_status = "none"
        fresh.link_error = None
        db.commit()


def link_commit(db: Session, commit_id: int) -> None:
    """Attribute one commit to a Jira task. Never raises — errors are stored.

    Honours cancellation at each checkpoint: a cancelled commit is left at
    ``link_status='none'`` (idle) rather than a match result.
    """
    commit = db.get(Commit, commit_id)
    if commit is None:
        return
    if _take_cancelled(commit_id):
        return _abort(db, commit)

    commit.link_status = "running"
    commit.link_error = None
    db.commit()

    try:
        # The match needs a summary, so make sure the commit has been analyzed.
        if commit.analysis_status != "ready" or not _commit_summary(commit):
            analyze_commit(db, commit_id)
            commit = db.get(Commit, commit_id)
            if commit is None:
                return
            commit.link_status = "running"
            db.commit()

        if _take_cancelled(commit_id):
            return _abort(db, commit)

        summary = _commit_summary(commit)
        authored = commit.authored_at
        project_id = commit.repo.project_id
        # A commit can only match a task owned by the same member as its author.
        member_id = commit.author.member_id if commit.author else None

        matched_id: int | None = None
        reason: str | None = None

        if summary and authored is not None and member_id is not None:
            candidates = _auto_candidates(db, project_id, member_id, authored)
            if candidates:
                by_key = {t.external_key.lower(): t for t in candidates}
                lines = "\n".join(
                    f"- [{t.external_key}] {t.title}"
                    + (f" — {(t.description or '').strip()[:_MAX_DESC]}" if t.description else "")
                    for t in candidates[:_MAX_CANDIDATES]
                )
                prompt = _PROMPT.format(
                    summary=summary,
                    message=(commit.message or "").strip()[:500] or "(no message)",
                    candidates=lines,
                )

                project = commit.repo.project
                provider = project.analysis_provider or settings.default_analysis_provider
                analyzer = analyzers.get_analyzer(provider, config={"model": project.analysis_model})
                result = analyzer.analyze(prompt)

                if _take_cancelled(commit_id):
                    return _abort(db, commit)

                data = result.data if isinstance(result.data, dict) else {}
                key = data.get("task_key")
                reason = data.get("reason")
                if isinstance(key, str):
                    match = by_key.get(key.strip().lower())
                    if match is not None:
                        matched_id = match.id

        commit.linked_task_id = matched_id
        commit.link_reason = reason if matched_id else None
        commit.link_status = "ready"
        commit.link_error = None
        db.commit()
        _clear_cancelled(commit_id)
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        db.rollback()
        commit = db.get(Commit, commit_id)
        if commit is not None:
            commit.link_status = "failed"
            commit.link_error = str(exc)[:1000]
            db.commit()
        _clear_cancelled(commit_id)


def unlinked_commit_ids(db: Session, project_id: int) -> list[int]:
    """Project commits eligible to enqueue (never linked, or last run failed)."""
    return list(
        db.execute(
            select(Commit.id)
            .join(GitRepo)
            .where(
                GitRepo.project_id == project_id,
                Commit.linked_task_id.is_(None),
                Commit.link_status.in_(("none", "failed")),
                Commit.is_merge.is_(False),
            )
            .order_by(Commit.authored_at.desc())
        ).scalars().all()
    )


# --------------------------------------------------------------- queue control

def enqueue_commit(db: Session, commit_id: int) -> Commit | None:
    """Put one commit on the attribution queue."""
    commit = db.get(Commit, commit_id)
    if commit is None:
        return None
    commit.link_status = "queued"
    commit.link_error = None
    db.commit()
    return commit


def enqueue_project_commits(db: Session, project_id: int) -> list[int]:
    """Queue every not-yet-linked commit in the project. Returns queued ids."""
    ids = unlinked_commit_ids(db, project_id)
    if ids:
        db.execute(
            update(Commit)
            .where(Commit.id.in_(ids))
            .values(link_status="queued", link_error=None)
        )
        db.commit()
    return ids


def candidate_tasks_for_commit(db: Session, commit: Commit) -> tuple[Sprint | None, list[Task]]:
    """All of the commit author's tasks for manual attach, covering-sprint first.

    Manual attach is human-driven, so it is deliberately broad — it must cover
    carry-over tasks and tasks created in a later sprint than the commit. Returns
    the sprint covering the commit date (for context) and the ordered task list.
    """
    member_id = commit.author.member_id if commit.author else None
    if member_id is None:
        return None, []
    covering = (
        _sprint_for(db, commit.repo.project_id, commit.authored_at)
        if commit.authored_at
        else None
    )
    cov_id = covering.id if covering else None
    tasks = _member_tasks(db, commit.repo.project_id, member_id)

    def sort_key(t: Task) -> tuple[int, float]:
        in_cov = 0 if (cov_id is not None and t.sprint_id == cov_id) else 1
        d = t.started_at_src or t.created_at_src
        return (in_cov, -(d.timestamp() if d else 0.0))  # covering first, then recent

    tasks.sort(key=sort_key)
    return covering, tasks


def attach_commit(db: Session, commit_id: int, task_id: int) -> Commit | None:
    """Manually attach a commit to a task (bypasses the LLM match)."""
    commit = db.get(Commit, commit_id)
    if commit is None:
        return None
    commit.linked_task_id = task_id
    commit.link_reason = "Manually attached"
    commit.link_status = "ready"
    commit.link_error = None
    _clear_cancelled(commit_id)
    db.commit()
    return commit


def reset_commit(db: Session, commit_id: int) -> Commit | None:
    """Clear a commit's existing task link and re-queue it for attribution.

    Used to re-run matching after the member-scoping rule changed (older links
    may have attached a commit to another member's task).
    """
    commit = db.get(Commit, commit_id)
    if commit is None:
        return None
    commit.linked_task_id = None
    commit.link_reason = None
    commit.link_status = "queued"
    commit.link_error = None
    db.commit()
    return commit


def reset_project_matches(db: Session, project_id: int) -> list[int]:
    """Clear and re-queue every already-matched commit in the project."""
    repo_ids = select(GitRepo.id).where(GitRepo.project_id == project_id)
    ids = list(
        db.execute(
            select(Commit.id).where(
                Commit.repo_id.in_(repo_ids),
                Commit.linked_task_id.is_not(None),
                Commit.is_merge.is_(False),
            )
        ).scalars().all()
    )
    if ids:
        db.execute(
            update(Commit)
            .where(Commit.id.in_(ids))
            .values(linked_task_id=None, link_reason=None, link_status="queued", link_error=None)
        )
        db.commit()
    return ids


def cancel_commit(db: Session, commit_id: int) -> Commit | None:
    """Remove a queued commit, or request cancellation of a running one."""
    commit = db.get(Commit, commit_id)
    if commit is None:
        return None
    if commit.link_status == "queued":
        commit.link_status = "none"
        commit.link_error = None
        db.commit()
    elif commit.link_status == "running":
        _mark_cancelled(commit_id)
    return commit


def cancel_project_commits(db: Session, project_id: int) -> int:
    """Clear the whole project queue and flag running commits for cancellation."""
    repo_ids = select(GitRepo.id).where(GitRepo.project_id == project_id)
    result = db.execute(
        update(Commit)
        .where(Commit.repo_id.in_(repo_ids), Commit.link_status == "queued")
        .values(link_status="none", link_error=None)
    )
    running = db.execute(
        select(Commit.id).where(
            Commit.repo_id.in_(repo_ids), Commit.link_status == "running"
        )
    ).scalars().all()
    db.commit()
    for cid in running:
        _mark_cancelled(cid)
    return (result.rowcount or 0) + len(running)


def run_link_worker(db: Session, project_id: int) -> None:
    """Drain the project's attribution queue, one commit at a time.

    A single worker runs per project; concurrent triggers return immediately and
    the active worker picks up anything they enqueued (it re-queries each loop).
    """
    with _worker_lock:
        if project_id in _active_projects:
            return
        _active_projects.add(project_id)
    try:
        while True:
            cid = db.execute(
                select(Commit.id)
                .join(GitRepo)
                .where(GitRepo.project_id == project_id, Commit.link_status == "queued")
                .order_by(Commit.authored_at.desc())
            ).scalars().first()
            if cid is None:
                break
            # Atomically claim it so a stray second worker can't double-process,
            # and a concurrent "remove from queue" (queued -> none) wins the race.
            claimed = db.execute(
                update(Commit)
                .where(Commit.id == cid, Commit.link_status == "queued")
                .values(link_status="running")
            ).rowcount
            db.commit()
            if not claimed:
                continue
            link_commit(db, cid)
    finally:
        with _worker_lock:
            _active_projects.discard(project_id)
