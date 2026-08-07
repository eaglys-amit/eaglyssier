"""MBO FORM② evaluation sheets: AI goal/result generation + HR checklist check.

Three background jobs per (project, member) sheet, all following the kpi.py
shape (status flip -> prompt -> analyzer -> store; never raises):
- generate_goals:   drafts Planned Goals per axis from the member's Jira tasks
- generate_results: fills Key Results + suggested Self Eval from commits,
                    completed tasks, PRs and reviews
- run_checklist:    runs HR's 16-item FORM② checker prompt against the sheet

Hard data gathering reuses app.services.kpi helpers; prompts and HR-authored
checklist content live in app.services.evaluation_prompts.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    EvaluationSheet,
    ProjectMember,
    PRReview,
    PullRequest,
    StatusCategory,
    Task,
)
from app.services import analyzers
from app.services import tasks as tasks_svc
from app.services.evaluation_prompts import (
    AXES,
    AXIS_KEYS,
    CHECKLIST_IDS,
    CHECKLIST_PROMPT,
    GOALS_PROMPT,
    GRADES,
    RESULTS_PROMPT,
)
from app.services.capacity import allocated_points_for_scope
from app.services.kpi import _compute_metrics, _identity_ids, _metrics_lines
from app.services.scope import (
    EMPTY_SCOPE,
    AnalysisScope,
    load_scope,
    pr_conditions,
    review_conditions,
    scoped_repo_ids,
    task_conditions,
)

_AXIS_LABELS = {key: label for key, label, *_ in AXES}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def default_axes() -> dict:
    return {
        k: {
            "planned_goal": "",
            "key_results": "",
            "self_eval": None,
            "tech_lead_eval": None,
            "final_eval": None,
        }
        for k in AXIS_KEYS
    }


def get_or_create_sheet(
    db: Session, project_id: int, member_id: int
) -> EvaluationSheet | None:
    """Return the member's sheet, creating it if missing. None if not a project member."""
    pm = db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .where(ProjectMember.member_id == member_id)
    ).scalars().first()
    if pm is None:
        return None
    sheet = db.execute(
        select(EvaluationSheet)
        .where(EvaluationSheet.project_id == project_id)
        .where(EvaluationSheet.member_id == member_id)
    ).scalars().first()
    if sheet is None:
        sheet = EvaluationSheet(
            project_id=project_id, member_id=member_id, axes=default_axes()
        )
        db.add(sheet)
        db.commit()
        db.refresh(sheet)
    return sheet


def _merged_axes(current: dict | None) -> dict:
    """Current axes overlaid on the full default shape (fresh dicts throughout)."""
    axes = default_axes()
    for k, cells in (current or {}).items():
        if k in axes and isinstance(cells, dict):
            axes[k] = {**axes[k], **cells}
    return axes


def _gather_task_samples(
    db: Session,
    project_id: int,
    identity_ids: list[int],
    scope: AnalysisScope = EMPTY_SCOPE,
) -> list[str]:
    """Assigned tasks as prompt lines (status · title — description).

    Deliberately omits Jira keys: Planned Goals are written as if authored at
    project start, so the generator must not cite tickets (see GOALS_PROMPT).
    """
    if not identity_ids:
        return []
    # Leaves only: containers would eat into the 40-row budget the real work
    # needs, and skew the generated Key Results toward epic-level phrasing.
    tasks = db.execute(
        tasks_svc.leaf_only(
            select(Task)
            .where(Task.project_id == project_id)
            .where(Task.assignee_identity_id.in_(identity_ids))
            .where(*task_conditions(scope))
        )
        .order_by(Task.created_at_src.desc().nullslast())
        .limit(40)
    ).scalars().all()
    samples = []
    for t in tasks:
        cat = t.status_category.value if t.status_category else "todo"
        desc = " ".join((t.description or "").split())[:300]
        line = f"- {cat} · {(t.title or '')[:120]}"
        if desc:
            line += f" — {desc}"
        samples.append(line)
    return samples


def _gather_done_task_samples(
    db: Session,
    project_id: int,
    identity_ids: list[int],
    scope: AnalysisScope = EMPTY_SCOPE,
) -> list[str]:
    if not identity_ids:
        return []
    tasks = db.execute(
        tasks_svc.leaf_only(
            select(Task)
            .where(Task.project_id == project_id)
            .where(Task.assignee_identity_id.in_(identity_ids))
            .where(Task.status_category == StatusCategory.done)
            .where(*task_conditions(scope))
        )
        .order_by(Task.resolved_at_src.desc().nullslast())
        .limit(40)
    ).scalars().all()
    samples = []
    for t in tasks:
        resolved = t.resolved_at_src.date().isoformat() if t.resolved_at_src else "?"
        label = tasks_svc.task_label(t)
        samples.append(
            f"- {label} · {(t.story_points or 0):g}sp · {resolved} · {(t.title or '')[:120]}"
        )
    return samples


def _gather_pr_activity(
    db: Session,
    project_id: int,
    identity_ids: list[int],
    scope: AnalysisScope = EMPTY_SCOPE,
) -> tuple[dict, list[str], list[str]]:
    """PRs authored and reviews given by the member: counts + prompt samples."""
    stats = {"prs_total": 0, "prs_merged": 0, "reviews_given": 0}
    pr_samples: list[str] = []
    review_samples: list[str] = []
    if not identity_ids:
        return stats, pr_samples, review_samples

    repo_ids = scoped_repo_ids(db, project_id, scope)
    if not repo_ids:
        return stats, pr_samples, review_samples

    authored = (
        select(PullRequest)
        .where(PullRequest.repo_id.in_(repo_ids))
        .where(PullRequest.author_identity_id.in_(identity_ids))
        .where(*pr_conditions(scope))
    )
    stats["prs_total"] = db.execute(
        select(func.count()).select_from(authored.subquery())
    ).scalar_one()
    stats["prs_merged"] = db.execute(
        select(func.count()).select_from(
            authored.where(PullRequest.merged_at_src.is_not(None)).subquery()
        )
    ).scalar_one()
    for pr in db.execute(
        authored.order_by(PullRequest.created_at_src.desc().nullslast()).limit(20)
    ).scalars():
        pr_samples.append(f"- {pr.state or '?'} · #{pr.external_id} {(pr.title or '')[:120]}")

    given = (
        select(PRReview, PullRequest)
        .join(PullRequest, PRReview.pr_id == PullRequest.id)
        .where(PullRequest.repo_id.in_(repo_ids))
        .where(PRReview.reviewer_identity_id.in_(identity_ids))
        .where(*review_conditions(scope))
    )
    stats["reviews_given"] = db.execute(
        select(func.count()).select_from(given.subquery())
    ).scalar_one()
    for review, pr in db.execute(
        given.order_by(PRReview.submitted_at.desc().nullslast()).limit(20)
    ).all():
        review_samples.append(
            f"- {review.state or '?'} · #{pr.external_id} {(pr.title or '')[:120]}"
        )
    return stats, pr_samples, review_samples


def _mark_checklist_stale(sheet: EvaluationSheet) -> None:
    """Goal content changed after the last check — the stored verdict no longer applies."""
    if isinstance(sheet.checklist, dict) and not sheet.checklist.get("stale"):
        sheet.checklist = {**sheet.checklist, "stale": True}


# Separator between the user's own evidence and the latest AI-suggested block;
# regenerating replaces everything after it instead of stacking new blocks.
_AI_EVIDENCE_MARKER = "--- AI suggested ---"


def _planned_goals_block(axes: dict) -> str:
    lines = []
    for key in AXIS_KEYS:
        goal = " ".join(((axes.get(key) or {}).get("planned_goal") or "").split())
        lines.append(f"[{_AXIS_LABELS[key]}]\n{goal or '(no planned goal)'}")
    return "\n\n".join(lines)


def claim_job(db: Session, sheet: EvaluationSheet, kind: str) -> bool:
    """Atomically flip the sheet to running. False if a job is already running."""
    claimed = db.execute(
        update(EvaluationSheet)
        .where(EvaluationSheet.id == sheet.id)
        .where(EvaluationSheet.job_status != "running")
        .values(job_status="running", job_kind=kind, job_error=None)
    )
    db.commit()
    db.refresh(sheet)
    return claimed.rowcount > 0


def _get_sheet(db: Session, project_id: int, member_id: int) -> EvaluationSheet | None:
    return db.execute(
        select(EvaluationSheet)
        .where(EvaluationSheet.project_id == project_id)
        .where(EvaluationSheet.member_id == member_id)
    ).scalars().first()


def _run_job(db: Session, project_id: int, member_id: int, kind: str, worker) -> None:
    """Shared job skeleton: worker -> ready/failed. Never raises.

    The caller (route) has already claimed the sheet via claim_job(); this only
    needs the row itself, so it keeps working even if the member was removed
    from the project after the claim.
    """
    sheet = _get_sheet(db, project_id, member_id)
    if sheet is None:
        return

    try:
        worker(sheet)
        sheet.job_status = "ready"
        sheet.job_error = None
        db.commit()
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        db.rollback()
        sheet = _get_sheet(db, project_id, member_id)
        if sheet is not None:
            sheet.job_status = "failed"
            sheet.job_kind = kind
            sheet.job_error = str(exc)[:1000]
            db.commit()


def _get_analyzer(sheet: EvaluationSheet):
    project = sheet.project
    provider = project.analysis_provider or settings.default_analysis_provider
    return analyzers.get_analyzer(provider, config={"model": project.analysis_model})


def _require_activity(db: Session, sheet: EvaluationSheet) -> list[int]:
    identity_ids = _identity_ids(db, sheet.project_id, sheet.member_id)
    if not identity_ids:
        raise analyzers.AnalyzerError(
            "No Jira/GitHub identities are mapped to this member on this project "
            "(map them on the Members tab, then sync)."
        )
    return identity_ids


def generate_goals(db: Session, project_id: int, member_id: int) -> None:
    """Draft Planned Goals per axis from the member's Jira tasks. Never raises."""

    def worker(sheet: EvaluationSheet) -> None:
        identity_ids = _require_activity(db, sheet)
        scope = load_scope(db, project_id, sheet.member_id)
        task_samples = _gather_task_samples(db, project_id, identity_ids, scope)
        if not task_samples:
            raise analyzers.AnalyzerError(
                "No Jira tasks are assigned to this member within the current "
                "analysis scope — sync Jira data or widen the scope on the Data tab."
            )
        prompt = GOALS_PROMPT.format(
            project=sheet.project.name,
            name=sheet.member.display_name,
            tasks="\n".join(task_samples),
        )
        result = _get_analyzer(sheet).analyze(prompt)
        data = result.data if isinstance(result.data, dict) else {}
        goals = {
            key: data[key].strip()
            for key in AXIS_KEYS
            if isinstance(data.get(key), str) and data[key].strip()
        }
        if not goals:
            raise analyzers.AnalyzerError(
                "The analyzer returned an unexpected response (no axis goals found) "
                "— try again."
            )

        axes = _merged_axes(sheet.axes)
        for key, goal in goals.items():
            axes[key] = {**axes[key], "planned_goal": goal}
        sheet.axes = axes
        _mark_checklist_stale(sheet)
        sheet.job_model = result.model
        sheet.goals_generated_at = _now()

    _run_job(db, project_id, member_id, "goals", worker)


def generate_results(db: Session, project_id: int, member_id: int) -> None:
    """Fill Key Results + suggested Self Eval from actual activity. Never raises."""

    def worker(sheet: EvaluationSheet) -> None:
        identity_ids = _require_activity(db, sheet)
        scope = load_scope(db, project_id, sheet.member_id)
        # Include every in-scope commit summary — a prolific member must not be
        # under-graded because their work was truncated to a sample.
        metrics, commit_samples, _ = _compute_metrics(
            db, project_id, identity_ids, scope, commit_sample_limit=None
        )
        metrics["story_points_allocated"] = allocated_points_for_scope(
            db, project_id, sheet.member_id, scope.sprint_ids
        )
        done_samples = _gather_done_task_samples(db, project_id, identity_ids, scope)
        pr_stats, pr_samples, review_samples = _gather_pr_activity(
            db, project_id, identity_ids, scope
        )
        if not commit_samples and not done_samples and not pr_samples:
            raise analyzers.AnalyzerError(
                "No completed tasks, commits, or pull requests are attributed to "
                "this member within the current analysis scope — sync data or "
                "widen the scope on the Data tab."
            )

        axes = _merged_axes(sheet.axes)
        metrics_text = (
            _metrics_lines(metrics)
            + f"\n- Pull requests: {pr_stats['prs_total']} ({pr_stats['prs_merged']} merged)"
            + f"\n- Code reviews given: {pr_stats['reviews_given']}"
        )
        prompt = RESULTS_PROMPT.format(
            project=sheet.project.name,
            name=sheet.member.display_name,
            planned_goals=_planned_goals_block(axes),
            metrics=metrics_text,
            tasks_done="\n".join(done_samples) or "(none)",
            commits="\n".join(commit_samples) or "(none)",
            prs="\n".join(pr_samples) or "(none)",
            reviews="\n".join(review_samples) or "(none)",
        )
        result = _get_analyzer(sheet).analyze(prompt)
        data = result.data if isinstance(result.data, dict) else {}
        result_axes = data.get("axes")
        if not isinstance(result_axes, dict) or not result_axes:
            raise analyzers.AnalyzerError(
                "The analyzer returned an unexpected response (no axis results found) "
                "— try again."
            )

        for key, cells in result_axes.items():
            if key not in AXIS_KEYS or not isinstance(cells, dict):
                continue
            patch: dict = {}
            key_results = cells.get("key_results")
            if isinstance(key_results, str) and key_results.strip():
                patch["key_results"] = key_results.strip()
            # Only overwrite the grade when the LLM gives one — a null answer
            # ("insufficient data") must not wipe a manually entered Self Eval.
            self_eval = cells.get("self_eval")
            if self_eval in GRADES:
                patch["self_eval"] = self_eval
            axes[key] = {**axes[key], **patch}
        sheet.axes = axes

        evidence_items = [
            str(e).strip() for e in (data.get("evidence") or []) if str(e).strip()
        ]
        if evidence_items:
            suggested = "\n".join(evidence_items)
            # Replace any previous AI block instead of stacking a new one per run.
            own = (sheet.evidence or "").split(_AI_EVIDENCE_MARKER, 1)[0].strip()
            if own:
                sheet.evidence = f"{own}\n{_AI_EVIDENCE_MARKER}\n{suggested}"
            else:
                sheet.evidence = suggested

        _mark_checklist_stale(sheet)
        sheet.job_model = result.model
        sheet.results_generated_at = _now()

    _run_job(db, project_id, member_id, "results", worker)


def run_checklist(db: Session, project_id: int, member_id: int) -> None:
    """Check the sheet's goals against HR's 16-item FORM② checklist. Never raises."""

    def worker(sheet: EvaluationSheet) -> None:
        axes = _merged_axes(sheet.axes)
        sheet_block = _planned_goals_block(axes)
        evidence = (sheet.evidence or "").strip()
        sheet_block += f"\n\n[Evidence of Outcomes]\n{evidence or '(empty)'}"

        prompt = CHECKLIST_PROMPT.format(
            project=sheet.project.name,
            name=sheet.member.display_name,
            sheet=sheet_block,
        )
        result = _get_analyzer(sheet).analyze(prompt)
        data = result.data if isinstance(result.data, dict) else {}
        raw_items = data.get("items")
        if not isinstance(raw_items, list) or not raw_items:
            raise analyzers.AnalyzerError(
                "The checker returned an unexpected response (no check items found) "
                "— try again."
            )

        # Normalize: exactly the 16 known ids in order; recompute the verdict
        # server-side rather than trusting the LLM's.
        by_id = {}
        for item in raw_items:
            if isinstance(item, dict) and item.get("id") in CHECKLIST_IDS:
                by_id[item["id"]] = item
        items = []
        for cid in CHECKLIST_IDS:
            raw = by_id.get(cid)
            if raw is None:
                items.append({
                    "id": cid, "status": "FAIL",
                    "reason": "No response from checker for this item.",
                    "suggestion": None,
                })
                continue
            status = "PASS" if str(raw.get("status", "")).strip().upper() == "PASS" else "FAIL"
            items.append({
                "id": cid,
                "status": status,
                "reason": str(raw.get("reason") or "").strip() or None,
                "suggestion": (str(raw.get("suggestion") or "").strip() or None)
                if status == "FAIL" else None,
            })
        verdict = "pass" if all(i["status"] == "PASS" for i in items) else "fail"
        sheet.checklist = {"verdict": verdict, "items": items, "stale": False}
        sheet.job_model = result.model
        sheet.checked_at = _now()

    _run_job(db, project_id, member_id, "checklist", worker)
