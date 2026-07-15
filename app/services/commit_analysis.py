"""Per-commit code analysis: fetch a commit's diff and summarise it with an LLM.

Provider-agnostic — the analyzer is resolved per project (see
app.services.analyzers). Only the "claude_cli" provider is wired today.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.connectors.dto import RepoDTO
from app.connectors.registry import build_connector
from app.models import Commit, GitRepo, Integration
from app.services import analyzers

_ELIGIBLE = ("none", "failed")

_PROMPT = """\
You are reviewing a single git commit. Describe concisely WHAT was done in this \
commit, based only on the diff below.

Commit message:
{message}

Author: {author}

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"summary": "one-sentence plain-language summary of the commit",
  "changes": ["specific thing that was done", "another thing", "..."],
  "categories": ["feature|fix|refactor|test|docs|chore|perf|build|style"],
  "files": [{{"path": "path/to/file", "what": "what changed in this file"}}]}}

{truncation_note}Unified diff:
{diff}
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _find_integration(db: Session, repo: GitRepo) -> Integration | None:
    return db.execute(
        select(Integration)
        .where(Integration.project_id == repo.project_id)
        .where(Integration.type == repo.provider)
        .where(Integration.enabled.is_(True))
    ).scalars().first()


def _build_diff_text(files, max_bytes: int) -> tuple[str, bool]:
    """Concatenate per-file patches into one diff string, capped at max_bytes."""
    parts: list[str] = []
    size = 0
    truncated = False
    for f in files:
        header = f"\n--- {f.path} ({f.status or 'modified'}) ---\n"
        body = f.patch or "(no textual diff available — binary or too large)\n"
        chunk = header + body
        if size + len(chunk) > max_bytes:
            parts.append(chunk[: max(0, max_bytes - size)])
            truncated = True
            break
        parts.append(chunk)
        size += len(chunk)
    return "".join(parts).strip(), truncated


def analyze_commit(db: Session, commit_id: int) -> None:
    """Analyze one commit and persist the result. Never raises — errors are stored."""
    commit = db.get(Commit, commit_id)
    if commit is None:
        return

    commit.analysis_status = "running"
    commit.analysis_error = None
    db.commit()

    try:
        repo = commit.repo
        project = repo.project
        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(provider, config={"model": project.analysis_model})

        integration = _find_integration(db, repo)
        if integration is None:
            raise RuntimeError(
                f"No enabled {repo.provider.value} integration for this project — "
                "cannot fetch the diff."
            )
        connector = build_connector(integration)
        repo_dto = RepoDTO(external_id=repo.external_id, name=repo.name, url=repo.url)

        diff = connector.fetch_commit_diff(repo_dto, commit.sha)
        diff_text, truncated = _build_diff_text(diff.files, settings.claude_max_diff_bytes)
        if not diff_text:
            raise RuntimeError("Commit has no textual diff to analyze.")

        author = (commit.author.display_name if commit.author else None) or "unknown"
        note = (
            "NOTE: the diff below was truncated for length; analyze what is shown.\n\n"
            if truncated
            else ""
        )
        prompt = _PROMPT.format(
            message=(commit.message or "").strip() or "(no message)",
            author=author,
            truncation_note=note,
            diff=diff_text,
        )

        result = analyzer.analyze(prompt)
        commit.analysis = result.data
        commit.analysis_model = result.model
        commit.analysis_status = "ready"
        commit.analysis_error = None
        commit.analyzed_at = _now()
        db.commit()
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        db.rollback()
        commit = db.get(Commit, commit_id)
        if commit is not None:
            commit.analysis_status = "failed"
            commit.analysis_error = str(exc)[:1000]
            commit.analyzed_at = _now()
            db.commit()


def eligible_commit_ids(db: Session, repo_id: int) -> list[int]:
    """Commit ids in a repo that still need analysis (anything not 'ready')."""
    return list(
        db.execute(
            select(Commit.id)
            .where(Commit.repo_id == repo_id)
            .where(Commit.analysis_status != "ready")
            .order_by(Commit.authored_at.desc())
        ).scalars().all()
    )


def analyze_repo_commits(
    db: Session, repo_id: int, commit_ids: list[int] | None = None
) -> None:
    """Analyze a repo's commits sequentially.

    When `commit_ids` is given, exactly those are processed (the caller has
    already marked them 'running'); otherwise every not-yet-'ready' commit is
    picked up. Processing the explicit id list avoids the trap where the caller
    flips rows to 'running' and a status-based re-query then matches nothing.
    """
    if commit_ids is None:
        commit_ids = eligible_commit_ids(db, repo_id)
    for cid in commit_ids:
        analyze_commit(db, cid)
