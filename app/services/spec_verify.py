"""Verification and coverage: is each requirement delivered, and what isn't traced?

- A person verifies a requirement by ticking its acceptance criteria; once every
  criterion is ticked and all linked tasks are done, its status is "verified"
  (app.services.specs.requirement_status).
- The optional AI check reads the linked tasks and their commits' analyses and
  suggests, per criterion, met / partial / not evident with evidence. It never
  ticks anything itself.
- Untraced work: recent tasks no requirement points at — scope that arrived
  without a spec, worth a look before it becomes the plan.
- Project coverage rolls the specs up for the Portfolio and Executive report.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.models import (
    Commit,
    Requirement,
    RequirementTask,
    Spec,
    Sprint,
    Task,
    User,
)
from app.schemas.spec import Coverage, SpecCoverageRow, UntracedTask
from app.services import analyzers
from app.services import specs as specs_svc
from app.services import tasks as tasks_svc

log = logging.getLogger(__name__)

MAX_COMMITS = 40
VERDICTS = {"met", "partial", "not_evident"}
REVIEW_GRACE_DAYS = 3  # a fresh spec change isn't a problem yet; a week-old one is
RECENT_CLOSED_SPRINTS = 1

_PROMPT = """\
You are checking whether a software requirement has been delivered, using ONLY \
the evidence below (tracker tasks and analyses of the commits linked to them). \
For each acceptance criterion decide:
- met: the evidence clearly shows it implemented
- partial: some of it is implemented, or it's implemented but something stated \
is missing
- not_evident: the evidence doesn't show it either way (absence of evidence is \
not failure — say what's missing)
Cite the task keys and short commit SHAs that support each verdict. Be concise.

Requirement {key}: {title}
Statement: {statement}

Acceptance criteria:
{criteria}

Linked tasks (key · status · title · acceptance criteria):
{tasks}

Commits on those tasks (sha · task · summary · changes):
{commits}

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"criteria": [{{"index": 1, "verdict": "met | partial | not_evident",
  "evidence": "one or two sentences citing tasks/commits"}}],
  "summary": "one sentence overall"}}
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------ manual ticks


def set_criterion(
    db: Session, req: Requirement, index: int, text: str, verified: bool, user: User
) -> None:
    """Tick or untick one criterion. `text` guards against a stale list."""
    criteria = [dict(c) for c in req.acceptance_criteria or []]
    if not 0 <= index < len(criteria) or criteria[index].get("text") != text:
        raise HTTPException(409, "The acceptance criteria changed; reload and try again.")
    who = user.member.display_name if user.member else user.email
    criteria[index].update(
        verified=verified,
        verified_by=who if verified else None,
        verified_at=_now().isoformat() if verified else None,
    )
    req.acceptance_criteria = criteria  # reassign: JSON columns don't track in-place edits
    db.commit()


# ---------------------------------------------------------------- AI check


def claim_ai_check(db: Session, req: Requirement) -> bool:
    claimed = db.execute(
        update(Requirement)
        .where(Requirement.id == req.id, Requirement.ai_check_status != "running")
        .values(ai_check_status="running", ai_check_error=None)
    )
    db.commit()
    db.refresh(req)
    return claimed.rowcount > 0


def _criteria_for(req: Requirement) -> tuple[list[str], bool]:
    """The criteria to judge; the statement stands in when there are none."""
    texts = [c.get("text", "") for c in req.acceptance_criteria or [] if c.get("text")]
    return (texts, False) if texts else ([req.statement or req.title], True)


def build_prompt(db: Session, req: Requirement) -> str:
    tasks = [link.task for link in req.task_links]
    if not tasks:
        raise analyzers.AnalyzerError("Link the tasks that implement this requirement first.")
    criteria, _ = _criteria_for(req)
    commits = db.execute(
        select(Commit)
        .where(Commit.linked_task_id.in_([t.id for t in tasks]))
        .order_by(Commit.authored_at.desc().nullslast())
        .limit(MAX_COMMITS)
    ).scalars().all()
    label = {t.id: tasks_svc.task_label(t) for t in tasks}

    def commit_line(c: Commit) -> str:
        a = c.analysis if isinstance(c.analysis, dict) else {}
        summary = a.get("summary") or (c.message or "").splitlines()[0][:160]
        changes = "; ".join(str(x) for x in (a.get("changes") or [])[:5])
        return f"- {c.sha[:8]} · {label.get(c.linked_task_id, '?')} · {summary}" + (
            f" · {changes}" if changes else "")

    return _PROMPT.format(
        key=req.key, title=req.title, statement=req.statement or "(none)",
        criteria="\n".join(f"{i}. {t}" for i, t in enumerate(criteria, 1)),
        tasks="\n".join(
            f"- {label[t.id]} · {t.status or t.status_category.value} · {t.title}"
            + (f" · AC: {' '.join((t.acceptance_criteria or '').split())[:300]}"
               if t.acceptance_criteria else "")
            for t in tasks
        ),
        commits="\n".join(commit_line(c) for c in commits)
        or "(no commits are linked to these tasks)",
    )


def parse_check(data: dict, criteria: list[str]) -> dict:
    items = data.get("criteria") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise analyzers.AnalyzerError("Model did not return a 'criteria' list.")
    by_index: dict[int, dict] = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        try:
            idx = int(it.get("index"))
        except (TypeError, ValueError):
            continue
        verdict = it.get("verdict") if it.get("verdict") in VERDICTS else "not_evident"
        by_index.setdefault(idx, {"verdict": verdict,
                                  "evidence": str(it.get("evidence") or "").strip()[:600]})
    return {
        "criteria": [
            {"text": text, **by_index.get(i, {"verdict": "not_evident", "evidence": ""})}
            for i, text in enumerate(criteria, 1)
        ],
        "summary": str(data.get("summary") or "").strip()[:400],
    }


def run_ai_check(db: Session, requirement_id: int) -> None:
    """Background job. Never raises — failures land on the row."""
    req = db.execute(
        select(Requirement).where(Requirement.id == requirement_id)
        .options(selectinload(Requirement.task_links).selectinload(RequirementTask.task),
                 selectinload(Requirement.spec).selectinload(Spec.project))
    ).scalar_one_or_none()
    if req is None:
        return
    try:
        criteria, from_statement = _criteria_for(req)
        prompt = build_prompt(db, req)
        project = req.spec.project
        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(provider, config={"model": project.analysis_model})
        result = analyzer.analyze(prompt)
        check = parse_check(result.data, criteria)
        req.ai_check = {**check, "from_statement": from_statement, "model": result.model,
                        "checked_at": _now().isoformat()}
        req.ai_check_status = "ready"
        req.ai_check_error = None
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("AI check failed for requirement %s: %s", requirement_id, exc)
        req = db.get(Requirement, requirement_id)
        if req is not None:
            req.ai_check_status = "failed"
            req.ai_check_error = str(exc)[:1000] or exc.__class__.__name__
            db.commit()


# ------------------------------------------------------------ untraced work


def untraced_work(db: Session, project_id: int) -> list[UntracedTask]:
    """Leaf tasks in active, upcoming and the latest closed sprint with no requirement.

    Empty when the project tracks no specs: without specs everything is
    "untraced", which says nothing.
    """
    has_specs = db.execute(select(Spec.id).where(Spec.project_id == project_id).limit(1)).first()
    if not has_specs:
        return []
    sprints = db.execute(
        select(Sprint).where(Sprint.project_id == project_id)
        .order_by(Sprint.start_date.desc().nullslast(), Sprint.id.desc())
    ).scalars().all()
    closed = [s for s in sprints if s.state == "closed"][:RECENT_CLOSED_SPRINTS]
    in_scope = {s.id: s for s in sprints if s.state in ("active", "future")} | {s.id: s for s in closed}
    if not in_scope:
        return []
    linked = select(RequirementTask.task_id)
    rows = db.execute(
        tasks_svc.leaf_only(
            select(Task).where(
                Task.project_id == project_id,
                Task.sprint_id.in_(list(in_scope)),
                Task.id.not_in(linked),
            )
        ).order_by(Task.rank, Task.id)
    ).scalars().all()
    return [
        UntracedTask(
            task_id=t.id, key=tasks_svc.task_label(t), title=t.title,
            status_category=t.status_category.value, story_points=t.story_points,
            sprint_id=t.sprint_id, sprint_name=in_scope[t.sprint_id].name,
            sprint_state=in_scope[t.sprint_id].state,
        )
        for t in rows
    ]


# ----------------------------------------------------------- project rollup


def project_coverage(db: Session, project_id: int) -> tuple[Coverage | None, list[SpecCoverageRow], int]:
    """(totals, per-spec rows, links awaiting review past the grace period).

    Approved specs count; drafts are still being shaped. When nothing is
    approved yet, drafts stand in so a new project isn't blank. None when the
    project tracks no specs at all.
    """
    summaries = specs_svc.list_specs(db, project_id)
    if not summaries:
        return None, [], 0
    counted = [s for s in summaries if s.status == "approved"] or summaries
    total = Coverage()
    rows = []
    for s in counted:
        for field in Coverage.model_fields:
            setattr(total, field, getattr(total, field) + getattr(s.coverage, field))
        rows.append(SpecCoverageRow(id=s.id, title=s.title, status=s.status, version=s.version,
                                    source=s.source, coverage=s.coverage))
    cutoff = _now() - timedelta(days=REVIEW_GRACE_DAYS)
    overdue = db.execute(
        select(RequirementTask.id)
        .join(Requirement, Requirement.id == RequirementTask.requirement_id)
        .join(Spec, Spec.id == Requirement.spec_id)
        .where(Spec.project_id == project_id, RequirementTask.needs_review.is_(True),
               RequirementTask.updated_at < cutoff)
    ).all()
    return total, rows, len(overdue)


def must_gaps(db: Session, project_id: int, limit: int = 5) -> list[dict]:
    """Untraced must-have requirements of approved specs: the gaps leadership should see."""
    reqs = db.execute(
        select(Requirement)
        .join(Spec, Spec.id == Requirement.spec_id)
        .where(Spec.project_id == project_id, Spec.status == "approved",
               Requirement.change_state != "removed", Requirement.priority == "must",
               Requirement.id.not_in(select(RequirementTask.requirement_id)))
        .order_by(Spec.title, Requirement.rank)
        .options(selectinload(Requirement.spec))
        .limit(limit)
    ).scalars().all()
    return [{"spec": r.spec.title, "key": r.key, "title": r.title} for r in reqs]
