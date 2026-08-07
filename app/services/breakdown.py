"""Turn reference documents into a drafted work tree, for a human to accept.

The model never writes to `tasks`. It fills a JSON draft, the user edits it, and
only an explicit accept materializes rows — so a hallucinated epic costs a
click to delete, not a cleanup migration.

:func:`normalize_nodes` is the trust boundary and runs on **both** the model's
output and the user's edits: unknown parent refs, cycles, duplicate ids,
off-deck estimates and unbounded node counts are all repaired or dropped there.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    ReferenceFile,
    Sprint,
    StatusCategory,
    StoryPointScale,
    Task,
    TaskBreakdown,
)
from app.services import analyzers
from app.services import references as refs
from app.services import scale as scale_svc
from app.services import tasks as tasks_svc

log = logging.getLogger("app.services.breakdown")

# A tree the room can actually review. Beyond this the model has almost
# certainly restated the document rather than planned it.
_MAX_NODES = 200
_LEVELS = ("epic", "task", "subtask")

_PROMPT = """\
You are a scrum lead turning reference material into an implementable work tree.

Project: {project}
Target sprint: {sprint}
Breaking down this existing task: {parent}

Story-point scale for this project (points · time band · risk · note):
{scale}

Extra instructions from the user:
{instructions}

Reference documents:
{documents}

Rules:
- At most three levels: epic -> task -> subtask. Not every branch needs all three.
- Estimate every LEAF node using ONLY these values: {deck}.
- A node that has children carries NO points; its children's estimates roll up.
- Any leaf you would estimate at {breakdown_points} must be split further instead.
- Ground everything in the documents. Do not invent scope they don't support.
- Prefer fewer, larger items over a long list of trivia.

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"nodes": [
  {{"id": "n1",
    "parent": null,
    "level": "epic | task | subtask",
    "title": "short imperative title",
    "description": "1-3 sentences on what this covers",
    "acceptance_criteria": "plain-text bullet list, or null",
    "issue_type": "Epic | Story | Task | Sub-task",
    "story_points": 3,
    "priority": "high | medium | low",
    "rationale": "one sentence on why this estimate"}}
]}}
Use null for story_points on any node that has children.
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------- creation


def create_breakdown(db: Session, project_id: int, data) -> TaskBreakdown:
    """Stage a breakdown request. The generation itself runs in the background."""
    row = TaskBreakdown(
        project_id=project_id,
        sprint_id=data.sprint_id,
        parent_task_id=data.parent_task_id,
        title=(data.title or "").strip() or "Task breakdown",
        instructions=(data.instructions or "").strip() or None,
        reference_file_ids=list(data.reference_file_ids or []),
        status="none",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def claim(db: Session, breakdown: TaskBreakdown) -> bool:
    """Atomically flip status -> 'running'. False if someone else got there first.

    Same shape as evaluation.claim_job: the UPDATE's own WHERE is the lock, so
    two simultaneous kickoffs can't both run the model.
    """
    claimed = db.execute(
        update(TaskBreakdown)
        .where(TaskBreakdown.id == breakdown.id)
        .where(TaskBreakdown.status != "running")
        .values(status="running", error=None)
    )
    db.commit()
    db.refresh(breakdown)
    return claimed.rowcount > 0


# ----------------------------------------------------------------- generation


def generate_breakdown(db: Session, breakdown_id: int) -> None:
    """Background job. Never raises — failures land on the row."""
    row = db.get(TaskBreakdown, breakdown_id)
    if row is None:
        return
    try:
        project = row.project
        deck = scale_svc.build_deck(db, row.project_id)
        if not deck.points:
            raise analyzers.AnalyzerError(
                "This project has no story-point scale, so there is nothing to "
                "estimate against. Set one on the Capacity tab first."
            )

        documents = refs.documents_text(
            db, row.reference_file_ids, budget=settings.breakdown_max_prompt_chars
        )
        if not documents.strip():
            raise analyzers.AnalyzerError(
                "None of the selected documents had extractable text to work from."
            )

        sprint = db.get(Sprint, row.sprint_id) if row.sprint_id else None
        parent = db.get(Task, row.parent_task_id) if row.parent_task_id else None
        prompt = _PROMPT.format(
            project=project.name,
            sprint=sprint.name if sprint else "(none — leave them in the backlog)",
            parent=(
                f"{tasks_svc.task_label(parent)} — {parent.title}" if parent else "(none)"
            ),
            scale=_scale_lines(db, row.project_id),
            instructions=row.instructions or "(none)",
            documents=documents,
            deck=", ".join(str(p) for p in deck.points),
            breakdown_points=(
                ", ".join(str(p) for p in deck.needs_breakdown) or "(none)"
            ),
        )

        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(
            provider, config={"model": project.analysis_model}
        )
        result = analyzer.analyze(prompt)

        nodes = normalize_nodes(result.data, deck.points)
        row.draft = {"nodes": nodes}
        row.model = result.model
        row.generated_at = _now()
        row.status = "ready"
        row.error = None
        db.commit()
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        db.rollback()
        row = db.get(TaskBreakdown, breakdown_id)
        if row is not None:
            row.status = "failed"
            row.error = str(exc)[:1000]
            db.commit()
        log.warning("breakdown %s failed: %s", breakdown_id, exc)


def _scale_lines(db: Session, project_id: int) -> str:
    rows = db.execute(
        select(StoryPointScale)
        .where(StoryPointScale.project_id == project_id)
        .order_by(StoryPointScale.points)
    ).scalars().all()
    lines = []
    for r in rows:
        band = (
            f"{r.min_hours:g}–{r.max_hours:g}h"
            if r.min_hours is not None and r.max_hours is not None
            else "unspecified"
        )
        flag = " · MUST BE BROKEN DOWN" if r.needs_breakdown else ""
        lines.append(f"- {r.points}: {band} · risk {r.risk}{flag}")
    return "\n".join(lines) or "(no scale defined)"


# -------------------------------------------------------------- normalization


def normalize_nodes(raw: object, deck: list[int]) -> list[dict]:
    """Coerce model (or user) output into a safe, acyclic, deck-aligned tree.

    Never trusts the input. Anything it can repair it repairs; anything it
    can't it drops, because a malformed tree would otherwise reach the
    recursive renderer in the UI.
    """
    if isinstance(raw, dict):
        items = raw.get("nodes")
    elif isinstance(raw, list):
        items = raw
    else:
        items = None
    if not isinstance(items, list) or not items:
        raise analyzers.AnalyzerError(
            "The analyzer returned an unexpected response (no nodes found) — try again."
        )

    cleaned: list[dict] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(items[:_MAX_NODES]):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue  # a node with no title is not a work item

        node_id = str(item.get("id") or "").strip() or f"n{index}"
        while node_id in seen_ids:  # de-duplicate rather than silently collide
            node_id = f"{node_id}_{index}"
        seen_ids.add(node_id)

        level = str(item.get("level") or "").strip().lower()
        cleaned.append(
            {
                "id": node_id,
                "parent": (str(item["parent"]).strip() if item.get("parent") else None),
                "level": level if level in _LEVELS else "task",
                "title": title[:512],
                "description": _text(item.get("description")),
                "acceptance_criteria": _text(item.get("acceptance_criteria")),
                "issue_type": _short(item.get("issue_type")),
                "story_points": _points(item.get("story_points")),
                "priority": _short(item.get("priority")),
                "rationale": _text(item.get("rationale")),
            }
        )

    if not cleaned:
        raise analyzers.AnalyzerError(
            "The analyzer returned no usable work items — try again."
        )

    ids = {n["id"] for n in cleaned}
    # Unknown or self parent -> top level.
    for node in cleaned:
        if node["parent"] is not None and (
            node["parent"] not in ids or node["parent"] == node["id"]
        ):
            node["parent"] = None
    _break_cycles(cleaned)

    # Points belong to leaves. Snap to the deck so an estimate is always a value
    # the team has a shared meaning for.
    has_children = {n["parent"] for n in cleaned if n["parent"]}
    for node in cleaned:
        if node["id"] in has_children:
            node["story_points"] = None
        elif node["story_points"] is not None and deck:
            node["story_points"] = float(
                min(deck, key=lambda p: (abs(p - node["story_points"]), p))
            )
    return cleaned


def _break_cycles(nodes: list[dict]) -> None:
    """Re-parent to top level any node whose ancestry loops."""
    parent_of = {n["id"]: n["parent"] for n in nodes}
    for node in nodes:
        seen = {node["id"]}
        cursor = node["parent"]
        while cursor is not None:
            if cursor in seen:
                node["parent"] = None
                break
            seen.add(cursor)
            cursor = parent_of.get(cursor)


def _text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:4000] or None


def _short(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:64] or None


def _points(value: object) -> float | None:
    try:
        points = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return points if points > 0 else None


# ------------------------------------------------------------- draft + accept


def save_draft(db: Session, breakdown: TaskBreakdown, nodes: list) -> TaskBreakdown:
    """Replace the draft with the user's edits, re-validated the same way."""
    deck = scale_svc.build_deck(db, breakdown.project_id)
    payload = [n.model_dump() if hasattr(n, "model_dump") else dict(n) for n in nodes]
    breakdown.draft = {"nodes": normalize_nodes({"nodes": payload}, deck.points)}
    breakdown.status = "ready"
    db.commit()
    db.refresh(breakdown)
    return breakdown


def accept_breakdown(
    db: Session, breakdown: TaskBreakdown, node_ids: list[str], sprint_id: int | None
) -> tuple[list[Task], list[str]]:
    """Materialize the selected nodes as real tasks, roots first."""
    nodes = list((breakdown.draft or {}).get("nodes") or [])
    if not nodes:
        raise analyzers.AnalyzerError("This breakdown has no draft to accept.")

    by_id = {n["id"]: n for n in nodes}
    wanted = _with_ancestors(by_id, node_ids)
    if not wanted:
        raise analyzers.AnalyzerError("No nodes were selected.")

    target_sprint = sprint_id if sprint_id is not None else breakdown.sprint_id
    if target_sprint is not None:
        sprint = db.get(Sprint, target_sprint)
        if sprint is None or sprint.project_id != breakdown.project_id:
            raise analyzers.AnalyzerError("The target sprint no longer exists.")

    created: list[Task] = []
    id_map: dict[str, int] = {}
    # Roots first, so a child's parent_id is always already known.
    for node in _topological(nodes, wanted):
        parent_db_id = (
            id_map.get(node["parent"]) if node["parent"] else None
        ) or breakdown.parent_task_id
        task = Task(
            project_id=breakdown.project_id,
            source="local",
            external_key=None,
            sprint_id=target_sprint,
            parent_id=parent_db_id,
            title=node["title"],
            description=node.get("description"),
            acceptance_criteria=node.get("acceptance_criteria"),
            issue_type=node.get("issue_type"),
            priority=node.get("priority"),
            story_points=node.get("story_points"),
            # Proposed, not agreed. Poker offers these as their own scope so the
            # room can challenge the model rather than inherit its guess.
            estimate_source="ai" if node.get("story_points") is not None else None,
            status="To Do",
            status_category=StatusCategory.todo,
            rank=tasks_svc.next_rank(db, breakdown.project_id),
            # The *_src rule: without these, local tasks vanish from scope
            # filtering, period reports, the Gantt and commit attribution.
            created_at_src=_now(),
            updated_at_src=_now(),
        )
        db.add(task)
        db.flush()  # need the id before its children are built
        id_map[node["id"]] = task.id
        created.append(task)

    breakdown.created_task_ids = [t.id for t in created]
    breakdown.accepted_at = _now()
    breakdown.status = "accepted"
    db.commit()

    warnings: list[str] = []
    for task in created:
        db.refresh(task)
        for warning in scale_svc.check_estimate(
            db, breakdown.project_id, task, task.story_points
        ):
            warnings.append(f"{tasks_svc.task_label(task)}: {warning}")
    return created, warnings


def _with_ancestors(by_id: dict[str, dict], node_ids: list[str]) -> set[str]:
    """Close the selection over ancestors — a subtask needs its parent chain."""
    wanted: set[str] = set()
    for node_id in node_ids:
        cursor: str | None = node_id
        guard = 0
        while cursor and cursor in by_id and cursor not in wanted and guard < 10:
            wanted.add(cursor)
            cursor = by_id[cursor].get("parent")
            guard += 1
    return wanted


def _topological(nodes: list[dict], wanted: set[str]) -> list[dict]:
    """Selected nodes, parents before children, original order within a level."""
    remaining = [n for n in nodes if n["id"] in wanted]
    placed: set[str] = set()
    out: list[dict] = []
    while remaining:
        progressed = False
        for node in list(remaining):
            parent = node["parent"]
            if parent is None or parent in placed or parent not in wanted:
                out.append(node)
                placed.add(node["id"])
                remaining.remove(node)
                progressed = True
        if not progressed:
            # Unreachable given _break_cycles, but a stuck loop would hang the
            # request — emit the rest flat instead.
            out.extend(remaining)
            break
    return out


def resolve_filenames(db: Session, file_ids: list[int]) -> list[str]:
    if not file_ids:
        return []
    rows = db.execute(
        select(ReferenceFile.id, ReferenceFile.filename).where(
            ReferenceFile.id.in_(file_ids)
        )
    ).all()
    names = dict(rows)
    return [names.get(fid, f"(deleted #{fid})") for fid in file_ids]
