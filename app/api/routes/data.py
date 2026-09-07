"""Read + delete endpoints for the Data tab: sprints, tasks, repos, commits, PRs."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_or_404, run_in_session
from app.db import get_db
from app.models import (
    Commit,
    GitRepo,
    MemberIdentity,
    Project,
    PRReview,
    PullRequest,
    Sprint,
    Task,
)
from app.schemas.data import (
    CommitAttachIn,
    CommitCandidateTask,
    CommitDetail,
    CommitLinkOut,
    CommitOut,
    GanttOut,
    PRReviewOut,
    PullRequestOut,
    RepoOut,
    SprintOut,
    TaskCommit,
    TaskDetail,
    TaskOut,
)
from app.schemas.jobs import AnalyzeAllOut
from app.services import tasks as tasks_svc
from app.services.commit_link import (
    attach_commit,
    candidate_tasks_for_commit,
    cancel_commit,
    cancel_project_commits,
    enqueue_commit,
    enqueue_project_commits,
    reset_commit,
    reset_project_matches,
    run_link_worker,
)
from app.services.gantt import build_gantt

router = APIRouter()


def _identity_name(ident: MemberIdentity | None) -> str | None:
    if ident is None:
        return None
    return ident.display_name or ident.username or ident.email


@router.get("/projects/{project_id}/sprints", response_model=list[SprintOut])
def list_sprints(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    sprints = db.execute(
        select(Sprint).where(Sprint.project_id == project_id).order_by(desc(Sprint.start_date))
    ).scalars().all()
    # Leaves only, so a breakdown tree counts as its real work items rather
    # than work items plus the containers holding them.
    counts = dict(
        db.execute(
            tasks_svc.leaf_only(
                select(Task.sprint_id, func.count(Task.id)).where(
                    Task.project_id == project_id
                )
            ).group_by(Task.sprint_id)
        ).all()
    )
    return [
        SprintOut.model_validate(s).model_copy(update={"task_count": counts.get(s.id, 0)})
        for s in sprints
    ]


@router.get("/projects/{project_id}/tasks", response_model=list[TaskOut])
def list_tasks(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    tasks = db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        # rank is the board's manual ordering and is seeded from external_key
        # for synced rows, so this stays stable for Jira-only projects.
        .order_by(Task.rank, Task.id)
        .options(selectinload(Task.assignee))
    ).scalars().all()
    return [
        TaskOut.model_validate(t).model_copy(
            update={
                "status_category": t.status_category.value,
                "description_preview": tasks_svc.description_preview(t.description),
                "assignee_name": _identity_name(t.assignee),
                "assignee_member_id": t.assignee.member_id if t.assignee else None,
            }
        )
        for t in tasks
    ]


@router.get("/projects/{project_id}/gantt", response_model=GanttOut)
def project_gantt(project_id: int, db: Session = Depends(get_db)):
    """Per-member timeline of Jira tasks with git commits attributed to them."""
    get_or_404(db, Project, project_id)
    return build_gantt(db, project_id)


def _commit_link_out(c: Commit) -> CommitLinkOut:
    return CommitLinkOut(
        commit_id=c.id,
        link_status=c.link_status,
        linked_task_id=c.linked_task_id,
        link_reason=c.link_reason,
        error=c.link_error,
    )


@router.post("/commits/{commit_id}/link", response_model=CommitLinkOut, status_code=202)
def link_one_commit(commit_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Queue a single commit for attribution and kick the project's drain worker."""
    commit = get_or_404(db, Commit, commit_id, "Commit")
    project_id = commit.repo.project_id
    enqueue_commit(db, commit_id)
    background.add_task(run_in_session, run_link_worker, project_id)
    return _commit_link_out(commit)


@router.post("/commits/{commit_id}/link/cancel", response_model=CommitLinkOut, status_code=202)
def cancel_one_commit(commit_id: int, db: Session = Depends(get_db)):
    """Remove a queued commit from the queue, or stop a running attribution."""
    get_or_404(db, Commit, commit_id, "Commit")
    commit = cancel_commit(db, commit_id)
    return _commit_link_out(commit)


@router.post("/commits/{commit_id}/link/reset", response_model=CommitLinkOut, status_code=202)
def reset_one_commit(commit_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Clear a matched commit's link and re-queue it for attribution."""
    existing = get_or_404(db, Commit, commit_id, "Commit")
    project_id = existing.repo.project_id
    commit = reset_commit(db, commit_id)
    background.add_task(run_in_session, run_link_worker, project_id)
    return _commit_link_out(commit)


@router.get("/commits/{commit_id}/detail", response_model=CommitDetail)
def commit_detail(commit_id: int, db: Session = Depends(get_db)):
    """Full commit view with the member's sprint tasks as manual-attach candidates."""
    c = get_or_404(db, Commit, commit_id, "Commit")
    sprint, tasks = candidate_tasks_for_commit(db, c)
    sprint_names = dict(
        db.execute(
            select(Sprint.id, Sprint.name).where(Sprint.project_id == c.repo.project_id)
        ).all()
    )
    analysis = c.analysis if isinstance(c.analysis, dict) else None
    return CommitDetail(
        id=c.id,
        sha=c.sha,
        message=c.message,
        authored_at=c.authored_at,
        additions=c.additions,
        deletions=c.deletions,
        files_changed=c.files_changed,
        author_name=_identity_name(c.author),
        summary=(analysis or {}).get("summary"),
        analysis=analysis,
        link_status=c.link_status,
        linked_task_id=c.linked_task_id,
        link_reason=c.link_reason,
        sprint_name=sprint.name if sprint else None,
        candidates=[
            CommitCandidateTask(
                id=t.id,
                key=tasks_svc.task_label(t),
                title=t.title,
                status_category=t.status_category.value,
                assignee_name=_identity_name(t.assignee),
                sprint_name=sprint_names.get(t.sprint_id),
            )
            for t in tasks
        ],
    )


@router.post("/commits/{commit_id}/link/attach", response_model=CommitLinkOut)
def attach_one_commit(commit_id: int, body: CommitAttachIn, db: Session = Depends(get_db)):
    """Manually attach a commit to a chosen Jira task."""
    get_or_404(db, Commit, commit_id, "Commit")
    get_or_404(db, Task, body.task_id, "Task")
    commit = attach_commit(db, commit_id, body.task_id)
    return _commit_link_out(commit)


@router.post("/projects/{project_id}/link-commits", response_model=AnalyzeAllOut, status_code=202)
def link_all_commits(project_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Queue every not-yet-linked commit in the project (the 'Analyze all')."""
    get_or_404(db, Project, project_id)
    ids = enqueue_project_commits(db, project_id)
    if ids:
        background.add_task(run_in_session, run_link_worker, project_id)
    return AnalyzeAllOut(queued=len(ids), commit_ids=ids)


@router.post("/projects/{project_id}/link-commits/cancel", response_model=AnalyzeAllOut, status_code=202)
def cancel_all_commits(project_id: int, db: Session = Depends(get_db)):
    """Clear the project's attribution queue and stop any running commits."""
    get_or_404(db, Project, project_id)
    count = cancel_project_commits(db, project_id)
    return AnalyzeAllOut(queued=count, commit_ids=[])


@router.post("/projects/{project_id}/link-commits/reset", response_model=AnalyzeAllOut, status_code=202)
def reset_all_matches(project_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Clear every matched commit's link and re-queue them (re-attribution)."""
    get_or_404(db, Project, project_id)
    ids = reset_project_matches(db, project_id)
    if ids:
        background.add_task(run_in_session, run_link_worker, project_id)
    return AnalyzeAllOut(queued=len(ids), commit_ids=ids)


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def task_detail(task_id: int, db: Session = Depends(get_db)):
    t = get_or_404(db, Task, task_id, "Task")
    sprint = db.get(Sprint, t.sprint_id) if t.sprint_id else None
    commits = db.execute(
        select(Commit)
        .where(Commit.linked_task_id == t.id)
        .order_by(Commit.authored_at)
        .options(selectinload(Commit.author))
    ).scalars().all()
    return TaskDetail(
        id=t.id,
        key=tasks_svc.task_label(t),
        title=t.title,
        description=t.description,
        acceptance_criteria=t.acceptance_criteria,
        issue_type=t.issue_type,
        status=t.status,
        status_category=t.status_category.value,
        story_points=t.story_points,
        priority=t.priority,
        source=t.source,
        parent_id=t.parent_id,
        parent_key=tasks_svc.task_label(t.parent) if t.parent else None,
        assignee_member_id=t.assignee.member_id if t.assignee else None,
        hours=round((t.worklog_seconds or 0) / 3600.0, 1),
        assignee=t.assignee.display_name if t.assignee else None,
        sprint=sprint.name if sprint else None,
        sprint_id=t.sprint_id,
        project_id=t.project_id,
        milestone_id=t.milestone_id,
        commits=[
            TaskCommit(
                id=c.id,
                sha=c.sha,
                authored_at=c.authored_at,
                summary=(c.analysis or {}).get("summary") if isinstance(c.analysis, dict) else None,
                author_name=_identity_name(c.author),
            )
            for c in commits
        ],
    )


@router.delete("/sprints/{sprint_id}", status_code=204)
def delete_sprint(sprint_id: int, db: Session = Depends(get_db)):
    """Remove a sprint and its *synced* tasks (a re-sync recreates those).

    Locally-created tasks are moved to the backlog instead of deleted — no
    re-sync can rebuild hand-planned work, so destroying it here would be
    silent, unrecoverable data loss.
    """
    sprint = db.get(Sprint, sprint_id)
    if sprint:
        db.query(Task).filter(
            Task.sprint_id == sprint.id, Task.source == "sync"
        ).delete(synchronize_session=False)
        db.query(Task).filter(Task.sprint_id == sprint.id).update(
            {Task.sprint_id: None}, synchronize_session=False
        )
        db.delete(sprint)
        db.commit()


@router.delete("/projects/{project_id}/sprints", status_code=204)
def delete_all_sprints(project_id: int, db: Session = Depends(get_db)):
    """Remove all of the project's sprints and their synced tasks.

    Backlog tasks (no sprint) are kept and locally-created tasks fall back to
    the backlog; a Jira re-sync recreates the synced side. Local sprints go
    too — the caller asked for all of them — but their tasks survive.
    """
    sprint_ids = select(Sprint.id).where(Sprint.project_id == project_id)
    db.query(Task).filter(
        Task.sprint_id.in_(sprint_ids), Task.source == "sync"
    ).delete(synchronize_session=False)
    db.query(Task).filter(Task.sprint_id.in_(sprint_ids)).update(
        {Task.sprint_id: None}, synchronize_session=False
    )
    db.query(Sprint).filter(Sprint.project_id == project_id).delete(synchronize_session=False)
    db.commit()


@router.delete("/projects/{project_id}/backlog", status_code=204)
def delete_backlog_tasks(
    project_id: int,
    include_local: bool = False,
    db: Session = Depends(get_db),
):
    """Clear the project's backlog. Synced tasks only unless `include_local`.

    The default is a "clear what Jira gave us" reset: the rows it removes come
    back on the next sync, so it is safe to press. Locally-created tasks —
    hand-made and AI-generated alike, along with any poker estimate on them —
    are what no re-sync can rebuild, so wiping them has to be asked for
    explicitly rather than ride along behind a 204.

    Either way this is a delete, not a detach: a removed task that parented work
    in a sprint leaves that child promoted to top level (tasks.parent_id is
    ON DELETE SET NULL), matching what deleting a single task already does.
    """
    query = db.query(Task).filter(
        Task.project_id == project_id,
        Task.sprint_id.is_(None),
    )
    if not include_local:
        query = query.filter(Task.source == "sync")
    query.delete(synchronize_session=False)
    db.commit()


@router.get("/projects/{project_id}/repos", response_model=list[RepoOut])
def list_repos(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    repos = db.execute(
        select(GitRepo).where(GitRepo.project_id == project_id).order_by(GitRepo.name)
    ).scalars().all()
    repo_ids = [r.id for r in repos]
    commit_counts: dict[int, int] = {}
    pr_counts: dict[int, int] = {}
    if repo_ids:
        commit_counts = dict(
            db.execute(
                select(Commit.repo_id, func.count(Commit.id))
                .where(Commit.repo_id.in_(repo_ids))
                .group_by(Commit.repo_id)
            ).all()
        )
        pr_counts = dict(
            db.execute(
                select(PullRequest.repo_id, func.count(PullRequest.id))
                .where(PullRequest.repo_id.in_(repo_ids))
                .group_by(PullRequest.repo_id)
            ).all()
        )
    return [
        RepoOut.model_validate(r).model_copy(
            update={
                "provider": r.provider.value,
                "commit_count": commit_counts.get(r.id, 0),
                "pr_count": pr_counts.get(r.id, 0),
            }
        )
        for r in repos
    ]


@router.delete("/repos/{repo_id}", status_code=204)
def delete_repo(repo_id: int, db: Session = Depends(get_db)):
    """Manually remove a synced repo and its commits/PRs (cascade)."""
    repo = db.get(GitRepo, repo_id)
    if repo:
        db.delete(repo)
        db.commit()


@router.get("/repos/{repo_id}/commits", response_model=list[CommitOut])
def list_commits(repo_id: int, db: Session = Depends(get_db)):
    get_or_404(db, GitRepo, repo_id, "Repo")
    commits = db.execute(
        select(Commit)
        .where(Commit.repo_id == repo_id)
        .order_by(desc(Commit.authored_at))
        .options(selectinload(Commit.author))
    ).scalars().all()
    return [
        CommitOut.model_validate(c).model_copy(
            update={
                "author_name": _identity_name(c.author),
                "author_member_id": c.author.member_id if c.author else None,
            }
        )
        for c in commits
    ]


@router.get("/repos/{repo_id}/pulls", response_model=list[PullRequestOut])
def list_pulls(repo_id: int, db: Session = Depends(get_db)):
    get_or_404(db, GitRepo, repo_id, "Repo")
    prs = db.execute(
        select(PullRequest)
        .where(PullRequest.repo_id == repo_id)
        .order_by(desc(PullRequest.created_at_src))
        .options(
            selectinload(PullRequest.author),
            selectinload(PullRequest.reviews).selectinload(PRReview.reviewer),
        )
    ).scalars().all()
    return [
        PullRequestOut.model_validate(pr).model_copy(
            update={
                "author_name": _identity_name(pr.author),
                "author_member_id": pr.author.member_id if pr.author else None,
                "reviews": [
                    PRReviewOut(
                        state=rv.state,
                        reviewer_name=_identity_name(rv.reviewer),
                        submitted_at=rv.submitted_at,
                    )
                    for rv in pr.reviews
                ],
            }
        )
        for pr in prs
    ]
