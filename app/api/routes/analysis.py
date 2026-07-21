"""LLM analysis jobs: per-commit analysis and repo summaries."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404, run_in_session
from app.db import get_db
from app.models import Commit, GitRepo
from app.schemas.jobs import AnalyzeAllOut, CommitAnalysisOut, RepoSummaryOut
from app.services.commit_analysis import analyze_commit, analyze_repo_commits
from app.services.repo_summary import summarize_repo

router = APIRouter()


def _analysis_out(c: Commit) -> CommitAnalysisOut:
    return CommitAnalysisOut(
        commit_id=c.id,
        status=c.analysis_status,
        analysis=c.analysis,
        error=c.analysis_error,
        model=c.analysis_model,
        analyzed_at=c.analyzed_at,
    )


def _summary_out(r: GitRepo) -> RepoSummaryOut:
    return RepoSummaryOut(
        repo_id=r.id,
        status=r.summary_status,
        summary=r.summary,
        error=r.summary_error,
        model=r.summary_model,
        summarized_at=r.summarized_at,
    )


@router.post("/commits/{commit_id}/analyze", response_model=CommitAnalysisOut, status_code=202)
def analyze(commit_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    commit = get_or_404(db, Commit, commit_id, "Commit")
    # Mark running now so the polling client shows a spinner immediately.
    commit.analysis_status = "running"
    commit.analysis_error = None
    db.commit()
    background.add_task(run_in_session, analyze_commit, commit_id)
    return _analysis_out(commit)


@router.get("/commits/{commit_id}/analysis", response_model=CommitAnalysisOut)
def analysis(commit_id: int, db: Session = Depends(get_db)):
    return _analysis_out(get_or_404(db, Commit, commit_id, "Commit"))


@router.post("/repos/{repo_id}/analyze-all", response_model=AnalyzeAllOut, status_code=202)
def analyze_all(repo_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    get_or_404(db, GitRepo, repo_id, "Repo")
    # Flip everything not-yet-'ready' to running up front (immediate UI feedback),
    # then hand the exact id list to the batch so it processes those rows rather
    # than re-querying by a status we just changed out from under it.
    eligible = db.execute(
        select(Commit)
        .where(Commit.repo_id == repo_id)
        .where(Commit.analysis_status != "ready")
        .where(Commit.is_merge.is_(False))  # merge commits carry no authored diff worth analyzing
        .order_by(Commit.authored_at.desc())
    ).scalars().all()
    ids = [c.id for c in eligible]
    for c in eligible:
        c.analysis_status = "running"
        c.analysis_error = None
    db.commit()
    if ids:
        background.add_task(run_in_session, analyze_repo_commits, repo_id, ids)
    return AnalyzeAllOut(queued=len(ids), commit_ids=ids)


@router.post("/repos/{repo_id}/summarize", response_model=RepoSummaryOut, status_code=202)
def summarize(repo_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    repo = get_or_404(db, GitRepo, repo_id, "Repo")
    repo.summary_status = "running"
    repo.summary_error = None
    db.commit()
    background.add_task(run_in_session, summarize_repo, repo_id)
    return _summary_out(repo)


@router.get("/repos/{repo_id}/summary", response_model=RepoSummaryOut)
def summary(repo_id: int, db: Session = Depends(get_db)):
    return _summary_out(get_or_404(db, GitRepo, repo_id, "Repo"))
