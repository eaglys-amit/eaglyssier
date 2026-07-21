"""Sync orchestration: pull from a connector and upsert into Postgres.

Idempotent by external id, so re-running a sync updates rather than duplicates.
Every run is recorded in `sync_runs` with per-entity counts.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete as sa_delete
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.connectors import build_connector
from app.connectors.base import GitConnector, IssueTrackerConnector
from app.connectors.dto import CommitDTO, PullRequestDTO, RepoDTO, SprintDTO, TaskDTO
from app.models import (
    Commit,
    GitRepo,
    Integration,
    PRReview,
    PullRequest,
    Sprint,
    StatusCategory,
    SyncRun,
    SyncStatus,
    Task,
)
from app.services.identity import resolve_identity

log = logging.getLogger("sync")

# Namespace for our transaction-scoped advisory locks (arbitrary constant that
# fits int4), so integration-id lock keys don't collide with other advisory
# lock users sharing this database.
_SYNC_LOCK_NS = 0x53594E43  # "SYNC"

# A `running` SyncRun older than this is assumed to be from a crashed/killed
# process and no longer blocks a new sync (it's marked failed instead).
_STALE_RUNNING_MIN = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _claim_run(db: Session, integration_id: int) -> SyncRun | None:
    """Atomically claim a sync slot; return a committed `running` SyncRun or None.

    A Postgres advisory lock makes the "is one already running?" check and the
    insert atomic, so two overlapping triggers (a scheduled run overlapping a
    manual one, or a double-clicked button) can't both start — the second gets
    None. The committed `running` row then guards the slot for the whole run and
    also drives the UI's live "Syncing…" indicator. `running` rows older than
    _STALE_RUNNING_MIN are treated as interrupted (marked failed) so a crashed
    process can't wedge syncing forever. The lock is transaction-scoped and
    releases on the commit below.
    """
    locked = db.execute(
        text("SELECT pg_try_advisory_xact_lock(:ns, :key)"),
        {"ns": _SYNC_LOCK_NS, "key": integration_id},
    ).scalar()
    if not locked:
        return None

    now = _now()
    cutoff = now - timedelta(minutes=_STALE_RUNNING_MIN)
    running = db.execute(
        select(SyncRun).where(
            SyncRun.integration_id == integration_id,
            SyncRun.status == SyncStatus.running,
        )
    ).scalars().all()
    if any(r.started_at and r.started_at >= cutoff for r in running):
        return None  # a live sync is already in progress
    for stale in running:  # crashed/interrupted -> don't leave it "running" forever
        stale.status = SyncStatus.failed
        stale.finished_at = now
        stale.error = stale.error or "Interrupted before completion."

    run = SyncRun(
        integration_id=integration_id, status=SyncStatus.running, started_at=now
    )
    db.add(run)
    db.commit()  # releases the advisory xact lock; the running row now guards the slot
    return run


def sync_integration(db: Session, integration_id: int) -> SyncRun | None:
    """Pull from a connector and upsert into Postgres.

    Records a `running` SyncRun up front and flips it to `success`/`failed` when
    done, so the UI can show live sync progress. Serialized per integration (see
    _claim_run): if another sync of the same integration is already running this
    call skips and returns None rather than racing on the upserts.
    """
    integration = db.get(Integration, integration_id)
    if integration is None:
        raise ValueError(f"Integration {integration_id} not found")

    run = _claim_run(db, integration_id)
    if run is None:
        log.info("Sync for integration %s already running; skipping.", integration_id)
        return None
    run_id = run.id

    stats: dict[str, int] = {}
    try:
        connector = build_connector(integration)
        if isinstance(connector, IssueTrackerConnector):
            stats.update(_sync_issue_tracker(db, integration, connector))
        if isinstance(connector, GitConnector):
            stats.update(_sync_git(db, integration, connector))
    except Exception as exc:  # noqa: BLE001 - any failure is recorded on the run
        db.rollback()  # discard partial writes from this attempt
        run = db.get(SyncRun, run_id)  # reload: rollback expired the row's state
        if run is not None:
            run.status = SyncStatus.failed
            run.finished_at = _now()
            run.error = str(exc)[:2000]
            db.commit()
        return run

    run.status = SyncStatus.success
    run.finished_at = _now()
    run.stats = stats
    db.commit()
    return run


def sync_repo(db: Session, repo_id: int) -> None:
    """Sync a single repository's commits & PRs from its provider integration.

    A lighter-weight counterpart to sync_integration for the per-repo Sync button
    on the Data tab: it refetches just this repo (no repo pruning). State lives on
    the GitRepo row (sync_status/sync_error/synced_at) so the UI can poll it.
    Never raises — failures are recorded on the row.
    """
    repo = db.get(GitRepo, repo_id)
    if repo is None:
        return
    repo.sync_status = "running"
    repo.sync_error = None
    db.commit()

    try:
        integration = db.execute(
            select(Integration).where(
                Integration.project_id == repo.project_id,
                Integration.type == repo.provider,
                Integration.enabled.is_(True),
            )
        ).scalars().first()
        if integration is None:
            raise RuntimeError(
                f"No enabled {repo.provider.value} integration for this project."
            )
        connector = build_connector(integration)
        if not isinstance(connector, GitConnector):
            raise RuntimeError(f"{repo.provider.value} connector cannot sync repositories.")

        repo_dto = RepoDTO(external_id=repo.external_id, name=repo.name, url=repo.url)
        n_commits = n_prs = n_reviews = 0
        for c in connector.fetch_commits(repo_dto):
            _upsert_commit(db, integration, repo, c)
            n_commits += 1
        for pr_dto in connector.fetch_pull_requests(repo_dto):
            _, rc = _upsert_pr(db, integration, repo, pr_dto)
            n_prs += 1
            n_reviews += rc
        db.flush()

        repo.sync_status = "done"
        repo.sync_error = None
        repo.synced_at = _now()
        db.commit()
        log.info("Synced repo %s: %d commits, %d PRs, %d reviews", repo_id, n_commits, n_prs, n_reviews)
    except Exception as exc:  # noqa: BLE001 - record failure on the row
        db.rollback()
        repo = db.get(GitRepo, repo_id)
        if repo is not None:
            repo.sync_status = "failed"
            repo.sync_error = str(exc)[:1000]
            repo.synced_at = _now()
            db.commit()


# ---------------------------------------------------------------- issue tracker

def _sync_issue_tracker(
    db: Session, integration: Integration, connector: IssueTrackerConnector
) -> dict[str, int]:
    project_id = integration.project_id
    sprint_by_ext: dict[str, Sprint] = {}

    n_sprints = 0
    for dto in connector.fetch_sprints():
        sprint = _upsert_sprint(db, project_id, dto)
        sprint_by_ext[dto.external_id] = sprint
        n_sprints += 1
    db.flush()

    n_tasks = 0
    for dto in connector.fetch_tasks():
        _upsert_task(db, integration, dto, sprint_by_ext)
        n_tasks += 1
    db.flush()
    return {"sprints": n_sprints, "tasks": n_tasks}


def _upsert_sprint(db: Session, project_id: int, dto: SprintDTO) -> Sprint:
    sprint = db.execute(
        select(Sprint).where(
            Sprint.project_id == project_id, Sprint.external_id == dto.external_id
        )
    ).scalar_one_or_none()
    if sprint is None:
        sprint = Sprint(project_id=project_id, external_id=dto.external_id, name=dto.name)
        db.add(sprint)
    sprint.name = dto.name
    sprint.state = dto.state
    sprint.start_date = dto.start_date
    sprint.end_date = dto.end_date
    sprint.complete_date = dto.complete_date
    sprint.goal = dto.goal
    db.flush()
    return sprint


def _upsert_task(
    db: Session, integration: Integration, dto: TaskDTO, sprint_by_ext: dict[str, Sprint]
) -> Task:
    project_id = integration.project_id
    task = db.execute(
        select(Task).where(
            Task.project_id == project_id, Task.external_key == dto.external_key
        )
    ).scalar_one_or_none()
    if task is None:
        task = Task(project_id=project_id, external_key=dto.external_key, title=dto.title)
        db.add(task)

    assignee = resolve_identity(db, project_id, integration.type, dto.assignee)
    sprint = sprint_by_ext.get(dto.sprint_external_id) if dto.sprint_external_id else None

    task.title = dto.title
    task.description = dto.description
    task.issue_type = dto.issue_type
    task.status = dto.status
    task.status_category = StatusCategory(dto.status_category)
    task.story_points = dto.story_points
    task.worklog_seconds = dto.worklog_seconds or 0
    task.reopened_count = dto.reopened_count
    task.assignee_identity_id = assignee.id if assignee else None
    task.sprint_id = sprint.id if sprint else None
    task.created_at_src = dto.created_at
    task.updated_at_src = dto.updated_at
    task.started_at_src = dto.started_at
    task.resolved_at_src = dto.resolved_at
    db.flush()
    return task


# ------------------------------------------------------------------------- git

def _sync_git(db: Session, integration: Integration, connector: GitConnector) -> dict[str, int]:
    n_repos = n_commits = n_prs = n_reviews = 0
    synced_external_ids: list[str] = []
    for repo_dto in connector.fetch_repos():
        repo = _upsert_repo(db, integration, repo_dto)
        synced_external_ids.append(repo.external_id)
        n_repos += 1
        for c in connector.fetch_commits(repo_dto):
            _upsert_commit(db, integration, repo, c)
            n_commits += 1
        for pr_dto in connector.fetch_pull_requests(repo_dto):
            _, rc = _upsert_pr(db, integration, repo, pr_dto)
            n_prs += 1
            n_reviews += rc
        db.flush()

    # keep only repos registered on the Integrations page: drop any previously
    # synced repo (same project+provider) no longer in the configured list. Runs
    # only after all configured repos fetched OK (a fetch failure raises earlier
    # and rolls back), so we never prune from a partial list.
    removed = _prune_repos(db, integration, synced_external_ids)

    stats = {"repos": n_repos, "commits": n_commits, "pull_requests": n_prs, "reviews": n_reviews}
    if removed:
        stats["repos_removed"] = removed
    return stats


def _prune_repos(db: Session, integration: Integration, keep_external_ids: list[str]) -> int:
    """Delete repos for this project+provider not in keep_external_ids.

    Commits/PRs/reviews cascade via their FK ondelete=CASCADE. Guarded against an
    empty keep-list so a no-op fetch can't wipe every repo.
    """
    if not keep_external_ids:
        return 0
    result = db.execute(
        sa_delete(GitRepo).where(
            GitRepo.project_id == integration.project_id,
            GitRepo.provider == integration.type,
            GitRepo.external_id.not_in(keep_external_ids),
        )
    )
    return result.rowcount or 0


def _upsert_repo(db: Session, integration: Integration, dto: RepoDTO) -> GitRepo:
    repo = db.execute(
        select(GitRepo).where(
            GitRepo.project_id == integration.project_id,
            GitRepo.provider == integration.type,
            GitRepo.external_id == dto.external_id,
        )
    ).scalar_one_or_none()
    if repo is None:
        repo = GitRepo(
            project_id=integration.project_id,
            provider=integration.type,
            external_id=dto.external_id,
            name=dto.name,
        )
        db.add(repo)
    repo.name = dto.name
    repo.url = dto.url
    db.flush()
    return repo


def _upsert_commit(db: Session, integration: Integration, repo: GitRepo, dto: CommitDTO) -> Commit:
    commit = db.execute(
        select(Commit).where(Commit.repo_id == repo.id, Commit.sha == dto.sha)
    ).scalar_one_or_none()
    if commit is None:
        commit = Commit(repo_id=repo.id, sha=dto.sha)
        db.add(commit)
    author = resolve_identity(db, integration.project_id, integration.type, dto.author)
    commit.author_identity_id = author.id if author else None
    commit.authored_at = dto.authored_at
    commit.additions = dto.additions
    commit.deletions = dto.deletions
    commit.files_changed = dto.files_changed
    commit.message = dto.message
    commit.is_merge = dto.is_merge
    db.flush()
    return commit


def _upsert_pr(
    db: Session, integration: Integration, repo: GitRepo, dto: PullRequestDTO
) -> tuple[PullRequest, int]:
    pr = db.execute(
        select(PullRequest).where(
            PullRequest.repo_id == repo.id, PullRequest.external_id == dto.external_id
        )
    ).scalar_one_or_none()
    if pr is None:
        pr = PullRequest(repo_id=repo.id, external_id=dto.external_id)
        db.add(pr)
    author = resolve_identity(db, integration.project_id, integration.type, dto.author)
    pr.title = dto.title
    pr.state = dto.state
    pr.author_identity_id = author.id if author else None
    pr.additions = dto.additions
    pr.deletions = dto.deletions
    pr.changed_files = dto.changed_files
    pr.created_at_src = dto.created_at
    pr.merged_at_src = dto.merged_at
    db.flush()

    review_count = 0
    for rev in dto.reviews:
        existing = db.execute(
            select(PRReview).where(
                PRReview.pr_id == pr.id, PRReview.external_id == rev.external_id
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = PRReview(pr_id=pr.id, external_id=rev.external_id)
            db.add(existing)
        reviewer = resolve_identity(db, integration.project_id, integration.type, rev.reviewer)
        existing.reviewer_identity_id = reviewer.id if reviewer else None
        existing.state = rev.state
        existing.submitted_at = rev.submitted_at
        review_count += 1
    db.flush()
    return pr, review_count
