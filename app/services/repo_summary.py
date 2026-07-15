"""Repository overview generation.

Builds a text digest of a repo's synced activity (contributors, commits, PRs, and
any existing per-commit analyses) and asks the project's configured LLM provider
for a structured overview. Reuses the same analyzer abstraction as commit analysis.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.models import Commit, GitRepo, PullRequest
from app.services import analyzers

_MAX_COMMITS_IN_PROMPT = 150
_MAX_PRS_IN_PROMPT = 80

_PROMPT = """\
You are writing a concise overview of a git repository for an engineering status \
report, based only on the activity digest below (synced commits, pull requests, and \
contributors). Do not invent facts that aren't supported by the digest.

Repository: {name} ({provider})

{digest}

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"overview": "2-4 sentence plain-language summary of what this repo is and the \
work happening in it",
  "highlights": ["notable theme or accomplishment", "another", "..."],
  "contributors": [{{"name": "contributor", "focus": "what they mainly worked on"}}],
  "tech_areas": ["area/component/technology touched", "..."],
  "activity": "one sentence on cadence and recency of work"}}
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _build_digest(commits: list[Commit], prs: list[PullRequest]) -> str:
    lines: list[str] = []
    lines.append(f"Totals: {len(commits)} commits, {len(prs)} pull requests.")

    # Contributor tally from commits.
    tally: dict[str, dict[str, int]] = defaultdict(lambda: {"commits": 0, "add": 0, "del": 0})
    for c in commits:
        name = (c.author.display_name if c.author else None) or "unknown"
        tally[name]["commits"] += 1
        tally[name]["add"] += c.additions or 0
        tally[name]["del"] += c.deletions or 0
    if tally:
        lines.append("\nContributors (by commits):")
        for name, t in sorted(tally.items(), key=lambda kv: kv[1]["commits"], reverse=True):
            lines.append(f"  - {name}: {t['commits']} commits, +{t['add']}/-{t['del']}")

    if commits:
        lines.append(f"\nRecent commits (up to {_MAX_COMMITS_IN_PROMPT}):")
        for c in commits[:_MAX_COMMITS_IN_PROMPT]:
            when = c.authored_at.strftime("%Y-%m-%d") if c.authored_at else "?"
            who = (c.author.display_name if c.author else None) or "unknown"
            msg = ((c.message or "").splitlines() or ["(no message)"])[0][:100]
            lines.append(f"  - {when} {who}: {msg}")
            # Fold in an existing per-commit analysis summary when present.
            if c.analysis_status == "ready" and isinstance(c.analysis, dict):
                s = (c.analysis.get("summary") or "").strip()
                if s:
                    lines.append(f"      analysis: {s[:160]}")

    if prs:
        lines.append(f"\nPull requests (up to {_MAX_PRS_IN_PROMPT}):")
        for pr in prs[:_MAX_PRS_IN_PROMPT]:
            who = (pr.author.display_name if pr.author else None) or "unknown"
            lines.append(
                f"  - #{pr.external_id} [{pr.state or '?'}] {who}: {(pr.title or '')[:100]}"
            )

    digest = "\n".join(lines)
    return digest[: settings.claude_max_diff_bytes]


def summarize_repo(db: Session, repo_id: int) -> None:
    """Generate and persist a repo overview. Never raises — errors are stored."""
    repo = db.get(GitRepo, repo_id)
    if repo is None:
        return

    repo.summary_status = "running"
    repo.summary_error = None
    db.commit()

    try:
        project = repo.project
        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(provider, config={"model": project.analysis_model})

        commits = db.execute(
            select(Commit)
            .where(Commit.repo_id == repo_id)
            .order_by(desc(Commit.authored_at))
            .options(selectinload(Commit.author))
        ).scalars().all()
        prs = db.execute(
            select(PullRequest)
            .where(PullRequest.repo_id == repo_id)
            .order_by(desc(PullRequest.created_at_src))
            .options(selectinload(PullRequest.author))
        ).scalars().all()

        if not commits and not prs:
            raise RuntimeError("Nothing synced for this repo yet — nothing to summarize.")

        prompt = _PROMPT.format(
            name=repo.name,
            provider=repo.provider.value,
            digest=_build_digest(commits, prs),
        )
        result = analyzer.analyze(prompt)
        repo.summary = result.data
        repo.summary_model = result.model
        repo.summary_status = "ready"
        repo.summary_error = None
        repo.summarized_at = _now()
        db.commit()
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        db.rollback()
        repo = db.get(GitRepo, repo_id)
        if repo is not None:
            repo.summary_status = "failed"
            repo.summary_error = str(exc)[:1000]
            repo.summarized_at = _now()
            db.commit()
