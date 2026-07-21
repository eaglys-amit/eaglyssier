"""Read + delete endpoints for the Data tab: sprints, tasks, repos, commits, PRs."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_or_404
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
    CommitOut,
    PRReviewOut,
    PullRequestOut,
    RepoOut,
    SprintOut,
    TaskDetail,
    TaskOut,
)

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
    counts = dict(
        db.execute(
            select(Task.sprint_id, func.count(Task.id))
            .where(Task.project_id == project_id)
            .group_by(Task.sprint_id)
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
        .order_by(Task.external_key)
        .options(selectinload(Task.assignee))
    ).scalars().all()
    return [
        TaskOut.model_validate(t).model_copy(
            update={
                "status_category": t.status_category.value,
                "assignee_name": _identity_name(t.assignee),
                "assignee_member_id": t.assignee.member_id if t.assignee else None,
            }
        )
        for t in tasks
    ]


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def task_detail(task_id: int, db: Session = Depends(get_db)):
    t = get_or_404(db, Task, task_id, "Task")
    sprint = db.get(Sprint, t.sprint_id) if t.sprint_id else None
    return TaskDetail(
        id=t.id,
        key=t.external_key,
        title=t.title,
        description=t.description,
        issue_type=t.issue_type,
        status=t.status,
        status_category=t.status_category.value,
        story_points=t.story_points,
        hours=round((t.worklog_seconds or 0) / 3600.0, 1),
        assignee=t.assignee.display_name if t.assignee else None,
        sprint=sprint.name if sprint else None,
    )


@router.delete("/sprints/{sprint_id}", status_code=204)
def delete_sprint(sprint_id: int, db: Session = Depends(get_db)):
    """Manually remove a synced sprint and its tasks (a re-sync recreates them)."""
    sprint = db.get(Sprint, sprint_id)
    if sprint:
        db.query(Task).filter(Task.sprint_id == sprint.id).delete(synchronize_session=False)
        db.delete(sprint)
        db.commit()


@router.delete("/projects/{project_id}/sprints", status_code=204)
def delete_all_sprints(project_id: int, db: Session = Depends(get_db)):
    """Remove all of the project's sprints and their tasks. Backlog tasks
    (no sprint) are kept; a Jira re-sync recreates everything."""
    sprint_ids = select(Sprint.id).where(Sprint.project_id == project_id)
    db.query(Task).filter(Task.sprint_id.in_(sprint_ids)).delete(synchronize_session=False)
    db.query(Sprint).filter(Sprint.project_id == project_id).delete(synchronize_session=False)
    db.commit()


@router.delete("/projects/{project_id}/backlog", status_code=204)
def delete_backlog_tasks(project_id: int, db: Session = Depends(get_db)):
    """Remove the project's backlog tasks (those without a sprint); a Jira
    re-sync recreates them."""
    db.query(Task).filter(
        Task.project_id == project_id, Task.sprint_id.is_(None)
    ).delete(synchronize_session=False)
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
