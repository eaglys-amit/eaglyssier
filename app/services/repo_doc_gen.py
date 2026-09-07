"""Writing a repository's documents: the prompt, the evidence, and the queue.

One document per model call. Generation is a queue, exactly like commit
attribution: enqueued documents sit at ``status='queued'``, a single per-repo
drain worker claims them one at a time to ``'running'``, and both states can be
cancelled cooperatively. Single-document generate goes through the same queue
rather than calling the model directly, so at most one subprocess runs per repo
— a direct fast path would let a per-document generate race the drain worker.

There is ONE prompt, parameterized by the row's title, guidance and
``context_kinds``, rather than eleven per-document constants. AI-suggested
documents have no constant and never will, so a parameterized prompt is
required regardless; keeping both mechanisms would mean template documents and
suggested documents travel different code paths, which is precisely the split
that rots. Everything that differs between a PRD and a CI/CD runbook is "what
sections, what evidence, what diagrams" — data, and it lives on the row.

The analyzer only ever returns parsed JSON (see analyzers.claude_cli), so a
document comes back as ``{"lines": [...]}`` — one markdown line per array
element. That removes newline escaping from the problem entirely, which matters
because a single stray literal newline inside one big JSON string fails the
*whole* document at json.loads with nothing recoverable. It also suits Mermaid,
which is line-oriented.

:func:`normalize_markdown` and :func:`normalize_suggestions` are the trust
boundaries, in the spirit of breakdown.normalize_nodes.
"""
from __future__ import annotations

import logging
import threading
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy import desc, select, update
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.models import (
    Commit,
    GitRepo,
    Milestone,
    PullRequest,
    RepoDoc,
    RepoDocFolder,
    Sprint,
    Task,
)
from app.services import analyzers
from app.services import references as refs
from app.services import repo_docs as docs_svc
from app.services import tasks as tasks_svc

log = logging.getLogger("app.services.repo_doc_gen")

# One drain worker per repo (best-effort; correctness comes from the atomic
# claim). Plus the set of running documents a user asked to cancel.
_worker_lock = threading.Lock()
_active_repos: set[int] = set()
_cancel_lock = threading.Lock()
_cancelled: set[int] = set()

# Beyond this the model has restated its evidence rather than written a document.
_MAX_LINES = 4000

_MAX_COMMITS = 150
_MAX_PRS = 80
_MAX_FILES = 60
_MAX_TASKS = 120

# Suggestions are a review step, not a bulk import: a list longer than this is
# not something anyone reads before ticking boxes.
_MAX_SUGGEST_FOLDERS = 3
_MAX_SUGGEST_DOCS = 8

# The reference documents get a capped share of the evidence budget so one long
# uploaded spec can't crowd out the repository's own history.
_REFERENCE_BUDGET_SHARE = 0.4

_PROMPT = """\
You are a senior engineer writing one document in a repository's documentation set.

Document: {title}
Filed under: {folder}

What this document must contain:
{guidance}

Extra instructions from the user:
{instructions}

Everything you know about this repository and its project:
{context}

Rules:
- GitHub-flavoured Markdown, opening with a single `# {title}` heading.
- Ground every factual claim in the evidence above. Where the guidance asks for
  something the evidence cannot support, put it under an "## Assumptions"
  heading and label it — do not invent specifics silently.
- Target about {target_words} words. Prefer tables and short sections to prose.
- Diagrams: use ```mermaid fenced blocks and nothing else — no ASCII art, no
  image links. Keep each diagram under ~25 nodes; split a larger one in two.
  Quote any node label containing spaces, parentheses or punctuation, like
  A["Auth service (JWT)"], and never put a semicolon inside a label. Omit a
  diagram entirely rather than inventing data to fill it.
- Never mention this prompt, the evidence digest, or yourself.

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"lines": ["# {title}", "", "## Overview", "One line of markdown per array item."],
  "summary": "one sentence describing what this document now says"}}
Each array item is ONE line of markdown. Never put a newline character inside a
string — start a new array item instead, and use "" for a blank line.
"""

_SUGGEST_PROMPT = """\
You are reviewing a repository's documentation set and proposing what is missing.

Repository: {name}

Folders already in the set:
{folders}

Documents already in the set:
{documents}

What this repository actually is:
{context}

Propose only documents that THIS repository specifically needs and that are not
already covered above — for example a data model reference for something
database-heavy, a migration guide for something with breaking releases, or an
operations playbook for a service. Propose nothing if the set is already
adequate; an empty list is a valid and useful answer.

Rules:
- At most {max_folders} new folders and {max_docs} new documents.
- Reuse an existing folder by putting its exact name in "folder". Only propose a
  new folder when nothing existing fits.
- Titles use Underscore_Case, like the existing ones.
- "guidance" is the brief for whoever writes it: what sections it must contain,
  and which mermaid diagrams belong in it (or that none do).
- "context_kinds" picks the evidence that document needs, from exactly:
  {kinds}

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"folders": [{{"key": "short_slug", "name": "05_Folder_Name", "why": "one sentence"}}],
  "documents": [{{"key": "short_slug", "title": "Document_Title",
                  "folder": "an existing folder name or a proposed folder key",
                  "guidance": "what this document must contain, and its diagrams",
                  "context_kinds": ["summary", "commits"],
                  "why": "one sentence on why this repository needs it"}}]}}
Use an empty list for either key when you have nothing to propose.
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- cancellation


def _mark_cancelled(doc_id: int) -> None:
    with _cancel_lock:
        _cancelled.add(doc_id)


def _take_cancelled(doc_id: int) -> bool:
    """Consume a pending cancel request for a document (True if one was set)."""
    with _cancel_lock:
        if doc_id in _cancelled:
            _cancelled.discard(doc_id)
            return True
        return False


def _clear_cancelled(doc_id: int) -> None:
    """Drop any residual flag once a document has finished processing.

    Guards against a Stop that raced a just-completing run leaving a stale flag
    that would abort the document's next generation.
    """
    with _cancel_lock:
        _cancelled.discard(doc_id)


def _abort(db: Session, doc_id: int) -> None:
    """Roll a cancelled document back to an idle, re-runnable state.

    Deliberately unlike commit_link._abort, which always resets to 'none': a
    document that already has content goes back to 'ready', because cancelling a
    *regenerate* must not blank the document the user is still reading. Only one
    that never had bytes falls back to 'none'.
    """
    db.rollback()
    fresh = db.get(RepoDoc, doc_id)
    if fresh is not None:
        fresh.status = "ready" if fresh.storage_key else "none"
        fresh.error = None
        db.commit()


# ---------------------------------------------------------------------- queue


def claim(db: Session, doc: RepoDoc) -> bool:
    """Atomically flip status -> 'running'. False if someone else got there first.

    Same shape as breakdown.claim: the UPDATE's own WHERE is the lock.
    """
    claimed = db.execute(
        update(RepoDoc)
        .where(RepoDoc.id == doc.id)
        .where(RepoDoc.status != "running")
        .values(status="running", error=None)
    )
    db.commit()
    db.refresh(doc)
    return bool(claimed.rowcount)


def enqueue_doc(
    db: Session,
    doc_id: int,
    *,
    instructions: str | None = None,
    reference_file_ids: list[int] | None = None,
) -> RepoDoc | None:
    """Put one document in its repo's queue, recording what was asked for."""
    doc = db.get(RepoDoc, doc_id)
    if doc is None:
        return None
    if doc.status == "running":
        return doc
    if instructions is not None:
        doc.instructions = instructions.strip() or None
    if reference_file_ids is not None:
        doc.reference_file_ids = list(reference_file_ids)
    doc.status = "queued"
    doc.error = None
    _clear_cancelled(doc_id)
    db.commit()
    db.refresh(doc)
    return doc


def enqueue_repo_docs(
    db: Session,
    repo_id: int,
    *,
    only_missing: bool = False,
    folder_id: int | None = None,
    instructions: str | None = None,
    reference_file_ids: list[int] | None = None,
    skip_hand_edited: bool = False,
) -> list[int]:
    """Queue a whole set (or one folder's subtree). Returns the queued ids.

    ``only_missing`` skips documents that already have content, which is the
    scope a user almost always wants: regenerating eleven documents to fill in
    the two that are blank is an expensive way to lose nine good ones.
    """
    rows = docs_svc.list_docs(db, repo_id)

    if folder_id is not None:
        folders = docs_svc.list_folders(db, repo_id)
        wanted = docs_svc.descendant_ids(folders, folder_id)
        rows = [d for d in rows if d.folder_id in wanted]

    queued: list[int] = []
    for doc in rows:
        if doc.status == "running":
            continue
        if only_missing and doc.storage_key:
            continue
        if skip_hand_edited and is_hand_edited(doc):
            continue
        if instructions is not None:
            doc.instructions = instructions.strip() or None
        if reference_file_ids is not None:
            doc.reference_file_ids = list(reference_file_ids)
        doc.status = "queued"
        doc.error = None
        _clear_cancelled(doc.id)
        queued.append(doc.id)
    db.commit()
    return queued


def cancel_doc(db: Session, doc_id: int) -> RepoDoc | None:
    """Remove a queued document, or request cancellation of a running one."""
    doc = db.get(RepoDoc, doc_id)
    if doc is None:
        return None
    if doc.status == "queued":
        doc.status = "ready" if doc.storage_key else "none"
        doc.error = None
        db.commit()
        db.refresh(doc)
    elif doc.status == "running":
        _mark_cancelled(doc_id)
    return doc


def cancel_repo_docs(db: Session, repo_id: int) -> int:
    """Clear the repo's queue and flag running documents for cancellation."""
    # Two statements, split on whether the document already has content. Mirrors
    # _abort: a queued regenerate falls back to 'ready' so Stop never blanks a
    # document the user is still reading; only one that never had bytes goes to
    # 'none'.
    cleared = db.execute(
        update(RepoDoc)
        .where(
            RepoDoc.repo_id == repo_id,
            RepoDoc.status == "queued",
            RepoDoc.storage_key.is_not(None),
        )
        .values(status="ready", error=None)
    )
    cleared_empty = db.execute(
        update(RepoDoc)
        .where(
            RepoDoc.repo_id == repo_id,
            RepoDoc.status == "queued",
            RepoDoc.storage_key.is_(None),
        )
        .values(status="none", error=None)
    )
    running = list(
        db.execute(
            select(RepoDoc.id).where(
                RepoDoc.repo_id == repo_id, RepoDoc.status == "running"
            )
        )
        .scalars()
        .all()
    )
    db.commit()
    for doc_id in running:
        _mark_cancelled(doc_id)
    return (cleared.rowcount or 0) + (cleared_empty.rowcount or 0) + len(running)


def run_doc_worker(db: Session, repo_id: int) -> None:
    """Drain the repo's document queue, one at a time.

    A single worker runs per repo; concurrent triggers return immediately and
    the active worker picks up whatever they enqueued, because it re-queries
    each loop. Ordering by ``rank`` needs no join to folders, which is why rank
    is repo-scoped on RepoDoc.
    """
    with _worker_lock:
        if repo_id in _active_repos:
            return
        _active_repos.add(repo_id)
    try:
        while True:
            doc_id = db.execute(
                select(RepoDoc.id)
                .where(RepoDoc.repo_id == repo_id, RepoDoc.status == "queued")
                .order_by(RepoDoc.rank, RepoDoc.id)
            ).scalars().first()
            if doc_id is None:
                break
            # Atomically claim it, so a stray second worker can't double-process
            # and a concurrent Stop (queued -> ready/none) wins the race.
            claimed = db.execute(
                update(RepoDoc)
                .where(RepoDoc.id == doc_id, RepoDoc.status == "queued")
                .values(status="running")
            ).rowcount
            db.commit()
            if not claimed:
                continue
            generate_doc(db, doc_id)
    finally:
        with _worker_lock:
            _active_repos.discard(repo_id)


def is_hand_edited(doc: RepoDoc) -> bool:
    """True when a human saved this document after the last generation.

    Derived rather than stored: the two timestamps already carry the fact, and a
    third column could disagree with them.
    """
    if doc.edited_at is None:
        return False
    return doc.generated_at is None or doc.edited_at > doc.generated_at


# ------------------------------------------------------------------- evidence


def _repo_header(repo: GitRepo) -> str:
    lines = [f"Repository: {repo.name} ({repo.provider.value})"]
    if repo.url:
        lines.append(f"URL: {repo.url}")
    if repo.synced_at:
        lines.append(f"Last synced: {repo.synced_at.date().isoformat()}")
    return "\n".join(lines)


def _summary_block(repo: GitRepo) -> str:
    """GitRepo.summary rendered as lines.

    Not json.dumps: the raw column spends a meaningful share of the budget on
    punctuation and reads worse. Follows deliverables._summaries_text.
    """
    data = repo.summary if isinstance(repo.summary, dict) else {}
    if not data:
        return ""
    lines: list[str] = []
    overview = (data.get("overview") or "").strip()
    if overview:
        lines.append(overview)
    for key, label in (
        ("tech_areas", "Technical areas"),
        ("highlights", "Highlights"),
    ):
        items = [str(v).strip() for v in (data.get(key) or []) if str(v).strip()]
        if items:
            lines.append(f"\n{label}:")
            lines += [f"  - {v}" for v in items]
    contributors = data.get("contributors") or []
    if isinstance(contributors, list) and contributors:
        lines.append("\nContributors:")
        for c in contributors:
            if isinstance(c, dict):
                lines.append(f"  - {c.get('name', '?')}: {c.get('focus', '')}".rstrip())
    activity = (data.get("activity") or "").strip()
    if activity:
        lines.append(f"\nActivity: {activity}")
    return "\n".join(lines)


def _commit_block(db: Session, repo_id: int) -> str:
    rows = db.execute(
        select(Commit)
        .where(Commit.repo_id == repo_id, Commit.is_merge.is_(False))
        .order_by(desc(Commit.authored_at))
        .limit(_MAX_COMMITS)
        .options(selectinload(Commit.author))
    ).scalars().all()
    if not rows:
        return ""
    lines = [f"{len(rows)} most recent commits:"]
    for c in rows:
        when = c.authored_at.strftime("%Y-%m-%d") if c.authored_at else "?"
        who = (c.author.display_name if c.author else None) or "unknown"
        msg = ((c.message or "").splitlines() or ["(no message)"])[0][:120]
        lines.append(f"  - {when} {who}: {msg}")
        if c.analysis_status == "ready" and isinstance(c.analysis, dict):
            s = (c.analysis.get("summary") or "").strip()
            if s:
                lines.append(f"      what it did: {s[:200]}")
    return "\n".join(lines)


def _file_block(db: Session, repo_id: int) -> str:
    """A file inventory rolled up from per-commit analyses.

    The schema holds no file tree and no dependency manifests — only the paths
    each commit analysis reported touching. Rolling those up most-touched-first
    is the closest thing to an inventory available, and it is what makes the
    CI/CD runbook, the dependency review and the security assessment groundable
    at all rather than pure invention. It only exists for repos whose commits
    have actually been analyzed, so an empty block here is normal and the
    document's guidance is what covers the gap.
    """
    rows = db.execute(
        select(Commit.analysis)
        .where(
            Commit.repo_id == repo_id,
            Commit.analysis_status == "ready",
            Commit.analysis.is_not(None),
        )
        .order_by(desc(Commit.authored_at))
        .limit(_MAX_COMMITS)
    ).scalars().all()

    tally: Counter[str] = Counter()
    what: dict[str, str] = {}
    for analysis in rows:
        if not isinstance(analysis, dict):
            continue
        for entry in analysis.get("files") or []:
            if not isinstance(entry, dict):
                continue
            path = str(entry.get("path") or "").strip()
            if not path:
                continue
            tally[path] += 1
            # Most recent wins: rows arrive newest-first.
            what.setdefault(path, str(entry.get("what") or "").strip())

    if not tally:
        return ""
    lines = [
        f"Files touched most often ({len(tally)} distinct paths seen in the "
        "analyzed commits):"
    ]
    for path, count in tally.most_common(_MAX_FILES):
        note = f" — {what[path][:120]}" if what.get(path) else ""
        lines.append(f"  - {path} ({count}x){note}")
    return "\n".join(lines)


def _pr_block(db: Session, repo_id: int) -> str:
    rows = db.execute(
        select(PullRequest)
        .where(PullRequest.repo_id == repo_id)
        .order_by(desc(PullRequest.created_at_src))
        .limit(_MAX_PRS)
        .options(selectinload(PullRequest.author))
    ).scalars().all()
    if not rows:
        return ""
    lines = [f"{len(rows)} most recent pull requests:"]
    for pr in rows:
        who = (pr.author.display_name if pr.author else None) or "unknown"
        lines.append(
            f"  - #{pr.external_id} [{pr.state or '?'}] {who}: {(pr.title or '')[:120]}"
        )
    return "\n".join(lines)


def _sprint_block(db: Session, project_id: int) -> str:
    rows = db.execute(
        select(Sprint).where(Sprint.project_id == project_id).order_by(Sprint.start_date)
    ).scalars().all()
    if not rows:
        return ""
    lines = ["Sprints:"]
    for s in rows:
        window = " to ".join(
            d.isoformat() for d in (s.start_date, s.end_date) if d
        ) or "undated"
        lines.append(f"  - {s.name} [{s.state or '?'}] {window}")
    return "\n".join(lines)


def _milestone_block(db: Session, project_id: int) -> str:
    rows = db.execute(
        select(Milestone)
        .where(Milestone.project_id == project_id)
        .order_by(Milestone.target_date)
    ).scalars().all()
    if not rows:
        return ""
    lines = ["Milestones:"]
    for m in rows:
        target = m.target_date.isoformat() if m.target_date else "unscheduled"
        lines.append(f"  - {m.name} [{m.state or '?'}] target {target}")
    return "\n".join(lines)


def _task_block(db: Session, project_id: int) -> str:
    """Leaf tasks only, so story points aren't double counted in the digest."""
    rows = db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .order_by(desc(Task.updated_at))
        .limit(_MAX_TASKS * 2)
    ).scalars().all()
    parents = {t.parent_id for t in rows if t.parent_id is not None}
    leaves = [t for t in rows if t.id not in parents][:_MAX_TASKS]
    if not leaves:
        return ""
    lines = [f"{len(leaves)} most recently updated tasks:"]
    for t in leaves:
        label = tasks_svc.task_label(t) or f"#{t.id}"
        points = f" {t.story_points}pt" if t.story_points else ""
        lines.append(
            f"  - {label} [{(t.status_category.value if t.status_category else '?')}]"
            f"{points}: {(t.title or '')[:120]}"
        )
    return "\n".join(lines)


_BLOCKS = (
    ("summary", "WHAT THIS REPOSITORY IS"),
    ("commits", "COMMIT HISTORY"),
    ("files", "FILES"),
    ("prs", "PULL REQUESTS"),
    ("sprints", "SPRINTS"),
    ("milestones", "MILESTONES"),
    ("tasks", "TASKS"),
)


def build_context(db: Session, doc: RepoDoc) -> str:
    """The evidence one document asked for. See :func:`build_repo_context`."""
    return build_repo_context(
        db,
        doc.repo,
        kinds=doc.context_kinds,
        reference_file_ids=doc.reference_file_ids,
    )


def build_repo_context(
    db: Session,
    repo: GitRepo,
    *,
    kinds: list[str] | None = None,
    reference_file_ids: list[int] | None = None,
) -> str:
    """Assemble a repository's evidence, under the char budget.

    Only the blocks named in ``kinds`` are built (empty or None means all of
    them), so a Competitor_Analysis isn't buried in sprint noise. When the total
    overruns, the tail is cut and an explicit note says so — silently
    overshooting would get the prompt truncated by the model instead, losing the
    end without telling anyone. references.documents_text sets that precedent.

    Takes a repo and plain lists rather than a RepoDoc so the suggestion flow,
    which has no document to describe, doesn't need a transient ORM row: one of
    those would start inserting junk the moment someone adds a back_populates to
    the RepoDoc.repo relationship.
    """
    project = repo.project
    wanted = set(kinds or []) or set(docs_svc.CONTEXT_KINDS)

    parts: list[str] = [_repo_header(repo)]
    for kind, heading in _BLOCKS:
        if kind not in wanted:
            continue
        if kind == "summary":
            body = _summary_block(repo)
        elif kind == "commits":
            body = _commit_block(db, repo.id)
        elif kind == "files":
            body = _file_block(db, repo.id)
        elif kind == "prs":
            body = _pr_block(db, repo.id)
        elif kind == "sprints":
            body = _sprint_block(db, project.id)
        elif kind == "milestones":
            body = _milestone_block(db, project.id)
        else:
            body = _task_block(db, project.id)
        if body:
            parts.append(f"## {heading}\n{body}")

    budget = settings.repo_doc_max_prompt_chars
    if reference_file_ids:
        # A capped share, so one long uploaded spec cannot crowd out the
        # repository's own history.
        ref_budget = int(budget * _REFERENCE_BUDGET_SHARE)
        ref_text = refs.documents_text(db, list(reference_file_ids), budget=ref_budget)
        if ref_text.strip():
            parts.append(f"## REFERENCE DOCUMENTS PROVIDED BY THE USER\n{ref_text}")
        budget -= min(len(ref_text), ref_budget)

    context = "\n\n".join(parts)
    if len(context) > budget:
        context = (
            context[:budget]
            + "\n\n(evidence truncated — the context budget was reached.)"
        )
    return context


# ---------------------------------------------------------------- generation


def normalize_markdown(raw: object, title: str) -> tuple[str, str | None]:
    """Coerce the model's reply into (markdown, summary). The trust boundary.

    Accepts the ``{"lines": [...]}`` contract the prompt asks for, and falls
    back to a plain ``{"markdown": "..."}`` string so a model that ignores the
    instruction degrades instead of failing. Mermaid is deliberately NOT
    validated here: a parse error is a render-time concern the UI degrades
    gracefully, and rejecting 1,200 good words over one bad diagram edge would
    be the worse trade.
    """
    data = raw if isinstance(raw, dict) else {}
    summary = str(data.get("summary") or "").strip() or None

    lines = data.get("lines")
    if isinstance(lines, list) and lines:
        text = "\n".join(str(item) for item in lines[:_MAX_LINES])
    else:
        text = data.get("markdown")
        text = text if isinstance(text, str) else ""

    text = _strip_document_fence(text).strip()
    if not text:
        raise analyzers.AnalyzerError(
            "The analyzer returned no document text — try generating it again."
        )

    # Guarantee a heading, so every document renders with a title whatever came
    # back. A body that opens mid-sentence is a worse failure than a duplicate.
    first = next((ln for ln in text.splitlines() if ln.strip()), "")
    if not first.lstrip().startswith("#"):
        text = f"# {title}\n\n{text}"

    return text[: settings.repo_doc_max_chars], summary


def _strip_document_fence(text: str) -> str:
    """Unwrap a fence around the WHOLE document.

    analyzers._strip_code_fences already unwraps a fence around the JSON; this
    catches the other case, where the document body itself arrived fenced. A
    fence that opens and closes mid-document is a real code block and is left
    alone.
    """
    stripped = text.strip()
    if not stripped.startswith("```"):
        return text
    body = stripped.split("\n", 1)[1] if "\n" in stripped else ""
    if body.rstrip().endswith("```") and body.rstrip()[:-3].count("```") == 0:
        return body.rstrip()[:-3]
    return text


def generate_doc(db: Session, doc_id: int) -> None:
    """Write one document. Never raises — failures land on the row."""
    doc = db.get(RepoDoc, doc_id)
    if doc is None:
        return
    if _take_cancelled(doc_id):
        return _abort(db, doc_id)

    doc.status = "running"
    doc.error = None
    db.commit()

    try:
        repo = doc.repo
        project = repo.project
        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(
            provider,
            config={
                "model": project.analysis_model,
                # A document is ~1200 words, an order of magnitude more than a
                # commit analysis, and routinely outruns the global default.
                "timeout": settings.repo_doc_timeout_seconds,
            },
        )

        folders = {f.id: f for f in docs_svc.list_folders(db, repo.id)}
        where = "/".join(f.name for f in docs_svc.folder_path(folders, doc.folder_id))
        prompt = _PROMPT.format(
            title=doc.title,
            folder=where or "the root of the set",
            guidance=doc.guidance or "Use your judgement for a document with this title.",
            instructions=doc.instructions or "(none)",
            context=build_context(db, doc),
            target_words=settings.repo_doc_target_words,
        )

        if _take_cancelled(doc_id):
            return _abort(db, doc_id)

        result = analyzer.analyze(prompt)

        # The model call is the expensive part, so this checkpoint discards a
        # finished result rather than aborting mid-flight.
        if _take_cancelled(doc_id):
            return _abort(db, doc_id)

        markdown, summary = normalize_markdown(result.data, doc.title)
        docs_svc.save_markdown(
            db, doc, markdown, model=result.model, summary=summary, generated=True
        )
    except Exception as exc:  # noqa: BLE001 - the row is the error channel
        log.warning("repo doc %s generation failed: %s", doc_id, exc)
        db.rollback()
        fresh = db.get(RepoDoc, doc_id)
        if fresh is not None:
            fresh.status = "failed"
            fresh.error = str(exc)[:1000]
            db.commit()
    finally:
        _clear_cancelled(doc_id)


# ------------------------------------------------------------------ suggestions


def suggest_docs(db: Session, repo_id: int) -> None:
    """Ask what else this repo needs documented. Never raises — errors on the row."""
    repo = db.get(GitRepo, repo_id)
    if repo is None:
        return

    repo.doc_suggest_status = "running"
    repo.doc_suggest_error = None
    db.commit()

    try:
        project = repo.project
        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(
            provider,
            config={
                "model": project.analysis_model,
                "timeout": settings.repo_doc_timeout_seconds,
            },
        )

        folders = docs_svc.list_folders(db, repo_id)
        existing_docs = docs_svc.list_docs(db, repo_id)
        by_id = {f.id: f for f in folders}

        prompt = _SUGGEST_PROMPT.format(
            name=repo.name,
            folders="\n".join(f"  - {f.name}" for f in folders) or "  (none)",
            documents="\n".join(
                "  - "
                + (
                    "/".join(x.name for x in docs_svc.folder_path(by_id, d.folder_id))
                    + "/"
                    if d.folder_id
                    else ""
                )
                + d.title
                for d in existing_docs
            )
            or "  (none)",
            context=build_repo_context(
                db, repo, kinds=["summary", "files", "commits"]
            ),
            max_folders=_MAX_SUGGEST_FOLDERS,
            max_docs=_MAX_SUGGEST_DOCS,
            kinds=", ".join(sorted(docs_svc.CONTEXT_KINDS)),
        )

        result = analyzer.analyze(prompt)
        repo = db.get(GitRepo, repo_id)
        repo.doc_suggestions = normalize_suggestions(db, repo_id, result.data)
        repo.doc_suggest_status = "ready"
        repo.doc_suggest_model = result.model
        repo.doc_suggested_at = _now()
        db.commit()
    except Exception as exc:  # noqa: BLE001 - the row is the error channel
        log.warning("repo doc suggestions for %s failed: %s", repo_id, exc)
        db.rollback()
        fresh = db.get(GitRepo, repo_id)
        if fresh is not None:
            fresh.doc_suggest_status = "failed"
            fresh.doc_suggest_error = str(exc)[:1000]
            db.commit()


def normalize_suggestions(db: Session, repo_id: int, raw: object) -> dict:
    """Clamp, de-duplicate and resolve the model's proposal. A trust boundary.

    Each proposal's folder is resolved to either a proposed folder key or an
    existing folder id **here**, and the resolution is stored — so accept never
    re-resolves against a tree that has changed in between. Anything already in
    the set is kept but flagged ``existing``, so the review UI can seed it
    unchecked instead of quietly growing a second copy.
    """
    data = raw if isinstance(raw, dict) else {}
    folders = docs_svc.list_folders(db, repo_id)
    existing_docs = docs_svc.list_docs(db, repo_id)
    by_id = {f.id: f for f in folders}

    folder_by_name = {f.name.casefold(): f for f in folders}
    titles_taken = {d.title.casefold() for d in existing_docs}

    items: list[dict] = []
    proposed_folders: dict[str, str] = {}  # key -> ref
    seen_refs: set[str] = set()

    for entry in (data.get("folders") or [])[:_MAX_SUGGEST_FOLDERS]:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        key = str(entry.get("key") or name).strip().lower()
        if not name or not key:
            continue
        ref = f"folder:{key}"
        if ref in seen_refs:
            continue
        seen_refs.add(ref)
        clash = folder_by_name.get(name.casefold())
        proposed_folders[key] = ref
        items.append(
            {
                "kind": "folder",
                "ref": ref,
                "name": name,
                "path": name,
                "parent_ref": None,
                "parent_folder_id": None,
                "rationale": str(entry.get("why") or "").strip() or None,
                "existing": clash is not None,
                "existing_id": clash.id if clash else None,
            }
        )

    for entry in (data.get("documents") or [])[:_MAX_SUGGEST_DOCS]:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()
        key = str(entry.get("key") or title).strip().lower()
        if not title or not key:
            continue
        ref = f"doc:{key}"
        if ref in seen_refs:
            continue
        seen_refs.add(ref)

        # Resolve the folder now: an existing folder by name, else one of the
        # folders proposed above, else the set root.
        raw_folder = str(entry.get("folder") or "").strip()
        existing_folder = folder_by_name.get(raw_folder.casefold())
        parent_ref = None
        parent_folder_id = None
        if existing_folder is not None:
            parent_folder_id = existing_folder.id
            where = "/".join(
                f.name for f in docs_svc.folder_path(by_id, existing_folder.id)
            )
        elif raw_folder.lower() in proposed_folders:
            parent_ref = proposed_folders[raw_folder.lower()]
            where = raw_folder
        else:
            where = ""

        items.append(
            {
                "kind": "doc",
                "ref": ref,
                "title": title,
                "path": f"{where}/{title}" if where else title,
                "parent_ref": parent_ref,
                "parent_folder_id": parent_folder_id,
                "guidance": str(entry.get("guidance") or "").strip() or None,
                "context_kinds": docs_svc.clean_context_kinds(
                    entry.get("context_kinds")
                ),
                "rationale": str(entry.get("why") or "").strip() or None,
                "existing": title.casefold() in titles_taken,
                "existing_id": None,
            }
        )

    return {"items": items}


def accept_suggestions(
    db: Session, repo_id: int, refs_wanted: list[str]
) -> tuple[list[RepoDocFolder], list[RepoDoc]]:
    """Create the ticked proposals. Folders first, then the documents in them.

    A ticked document pulls in the folder it needs even when that folder was
    not ticked itself, because accepting a document into a folder that doesn't
    exist would silently drop it at the root — the same closure breakdown's
    accept does over ancestors.
    """
    repo = docs_svc.get_repo_or_404(db, repo_id)
    payload = repo.doc_suggestions if isinstance(repo.doc_suggestions, dict) else {}
    items = {i["ref"]: i for i in payload.get("items") or [] if isinstance(i, dict)}

    wanted = {r for r in refs_wanted if r in items}
    # Close over the folders the ticked documents need.
    for ref in list(wanted):
        parent = items[ref].get("parent_ref")
        if parent and parent in items:
            wanted.add(parent)

    created_folders: list[RepoDocFolder] = []
    folder_ids: dict[str, int] = {}
    for ref, item in items.items():
        if ref not in wanted or item["kind"] != "folder":
            continue
        if item.get("existing_id"):
            # Already there under that exact name — reuse it rather than
            # creating a near-duplicate the user would have to merge by hand.
            folder_ids[ref] = int(item["existing_id"])
            continue
        try:
            row = docs_svc.create_folder(
                db, repo_id, name=item["name"], source="ai"
            )
        except docs_svc.DocError as exc:
            log.warning("skipping suggested folder %s: %s", item.get("name"), exc.detail)
            continue
        created_folders.append(row)
        folder_ids[ref] = row.id

    created_docs: list[RepoDoc] = []
    for ref, item in items.items():
        if ref not in wanted or item["kind"] != "doc":
            continue
        folder_id = item.get("parent_folder_id")
        if folder_id is None and item.get("parent_ref"):
            folder_id = folder_ids.get(item["parent_ref"])
        try:
            created_docs.append(
                docs_svc.create_doc(
                    db,
                    repo_id,
                    title=item["title"],
                    folder_id=folder_id,
                    guidance=item.get("guidance"),
                    context_kinds=item.get("context_kinds") or [],
                    source="ai",
                )
            )
        except docs_svc.DocError as exc:
            log.warning("skipping suggested doc %s: %s", item.get("title"), exc.detail)

    dismiss_suggestions(db, repo_id)
    return created_folders, created_docs


def dismiss_suggestions(db: Session, repo_id: int) -> None:
    """Clear the staged proposal. Nothing here is worth keeping once acted on."""
    repo = db.get(GitRepo, repo_id)
    if repo is None:
        return
    repo.doc_suggestions = None
    repo.doc_suggest_status = "none"
    repo.doc_suggest_error = None
    db.commit()
