"""Per-member KPI generation from commits + Jira tasks.

Hard metrics (commit counts, lines, story points, hours, task throughput) are
computed deterministically in Python; the LLM is asked only for the qualitative
assessment (rating, strengths, areas to improve, narrative). Both are stored
together on the ProjectMember row. Reuses the shared analyzer abstraction.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Commit,
    MemberIdentity,
    ProjectMember,
    StatusCategory,
    Task,
)
from app.services import analyzers
from app.services.capacity import allocated_points_for_scope
from app.services.scope import (
    EMPTY_SCOPE,
    AnalysisScope,
    commit_conditions,
    load_scope,
    scoped_repo_ids,
    task_conditions,
)

_PROMPT = """\
You are assessing one team member's contribution to a software project for a \
performance KPI, using only the metrics and work samples below. Be fair and \
specific; do not invent data.

Member: {name}

Computed metrics (source of truth — do not contradict these):
{metrics}

Recent commit summaries:
{commits}

Assigned Jira tasks (status · story points · title):
{tasks}

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"rating": "one of: Outstanding | Exceeds | Meets | Below | Insufficient data",
  "score": 1-5 integer (5 best; use your judgement, 1 if almost no work),
  "summary": "2-4 sentence narrative assessment grounded in the metrics",
  "strengths": ["specific strength", "..."],
  "improvements": ["specific, constructive area to improve", "..."]}}
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _identity_ids(db: Session, project_id: int, member_id: int) -> list[int]:
    return list(
        db.execute(
            select(MemberIdentity.id)
            .where(MemberIdentity.project_id == project_id)
            .where(MemberIdentity.member_id == member_id)
        ).scalars().all()
    )


def _compute_metrics(
    db: Session,
    project_id: int,
    identity_ids: list[int],
    scope: AnalysisScope = EMPTY_SCOPE,
    commit_sample_limit: int | None = 40,
) -> tuple[dict, list, list]:
    """Return (metrics dict, commit samples, task samples) for a member.

    Metric counts always cover every in-scope row. commit_sample_limit caps the
    number of commit *summaries* passed to the LLM (None = all in-scope commits);
    evaluation result generation uses None so no contribution is under-represented.
    """
    metrics = {
        "commits": 0, "additions": 0, "deletions": 0,
        "tasks_total": 0, "tasks_done": 0, "tasks_in_progress": 0, "tasks_todo": 0,
        "story_points_total": 0.0, "story_points_completed": 0.0,
        "story_points_allocated": 0.0,
        "hours_logged": 0.0, "reopened": 0,
    }
    commit_samples: list[str] = []
    task_samples: list[str] = []
    if not identity_ids:
        return metrics, commit_samples, task_samples

    repo_ids = scoped_repo_ids(db, project_id, scope)
    if repo_ids:
        commits = db.execute(
            select(Commit)
            .where(Commit.repo_id.in_(repo_ids))
            .where(Commit.author_identity_id.in_(identity_ids))
            .where(Commit.is_merge.is_(False))  # PR merges/branch updates aren't authored work
            .where(*commit_conditions(scope))
            .order_by(Commit.authored_at.desc())
        ).scalars().all()
        for c in commits:
            metrics["commits"] += 1
            metrics["additions"] += c.additions or 0
            metrics["deletions"] += c.deletions or 0
            if commit_sample_limit is None or len(commit_samples) < commit_sample_limit:
                if c.analysis_status == "ready" and isinstance(c.analysis, dict) and c.analysis.get("summary"):
                    commit_samples.append(f"- {c.analysis['summary'][:160]}")
                elif c.message:
                    commit_samples.append(f"- {c.message.splitlines()[0][:120]}")

    tasks = db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .where(Task.assignee_identity_id.in_(identity_ids))
        .where(*task_conditions(scope))
    ).scalars().all()
    for t in tasks:
        metrics["tasks_total"] += 1
        sp = t.story_points or 0.0
        metrics["story_points_total"] += sp
        metrics["hours_logged"] += (t.worklog_seconds or 0) / 3600.0
        metrics["reopened"] += t.reopened_count or 0
        cat = t.status_category
        if cat == StatusCategory.done:
            metrics["tasks_done"] += 1
            metrics["story_points_completed"] += sp
        elif cat == StatusCategory.in_progress:
            metrics["tasks_in_progress"] += 1
        else:
            metrics["tasks_todo"] += 1
        if len(task_samples) < 40:
            catname = cat.value if cat else "todo"
            task_samples.append(f"- {catname} · {sp:g}sp · {(t.title or '')[:100]}")

    metrics["story_points_total"] = round(metrics["story_points_total"], 1)
    metrics["story_points_completed"] = round(metrics["story_points_completed"], 1)
    metrics["hours_logged"] = round(metrics["hours_logged"], 1)
    return metrics, commit_samples, task_samples


def _metrics_lines(m: dict) -> str:
    return (
        f"- Commits: {m['commits']} (+{m['additions']}/-{m['deletions']} lines)\n"
        f"- Tasks: {m['tasks_total']} total — {m['tasks_done']} done, "
        f"{m['tasks_in_progress']} in progress, {m['tasks_todo']} to do\n"
        f"- Story points: {m['story_points_completed']:g} completed of "
        f"{m['story_points_total']:g} assigned · "
        f"{m.get('story_points_allocated', 0):g} allocated (capacity)\n"
        f"- Hours logged: {m['hours_logged']:g}\n"
        f"- Tasks reopened: {m['reopened']}"
    )


def generate_member_kpi(db: Session, project_id: int, member_id: int) -> None:
    """Generate and persist a member's KPI. Never raises — errors are stored."""
    pm = db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .where(ProjectMember.member_id == member_id)
    ).scalars().first()
    if pm is None:
        return

    pm.kpi_status = "running"
    pm.kpi_error = None
    db.commit()

    try:
        member = pm.member
        provider = pm.project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(provider, config={"model": pm.project.analysis_model})

        identity_ids = _identity_ids(db, project_id, member_id)
        scope = load_scope(db, project_id, member_id)
        metrics, commit_samples, task_samples = _compute_metrics(
            db, project_id, identity_ids, scope
        )
        metrics["story_points_allocated"] = allocated_points_for_scope(
            db, project_id, member_id, scope.sprint_ids
        )

        prompt = _PROMPT.format(
            name=member.display_name,
            metrics=_metrics_lines(metrics),
            commits="\n".join(commit_samples) or "(no commits attributed)",
            tasks="\n".join(task_samples) or "(no tasks assigned)",
        )
        result = analyzer.analyze(prompt)

        # Store computed metrics alongside the AI assessment.
        assessment = result.data if isinstance(result.data, dict) else {}
        pm.kpi = {"metrics": metrics, **assessment}
        pm.kpi_model = result.model
        pm.kpi_status = "ready"
        pm.kpi_error = None
        pm.kpi_generated_at = _now()
        db.commit()
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        db.rollback()
        pm = db.execute(
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .where(ProjectMember.member_id == member_id)
        ).scalars().first()
        if pm is not None:
            pm.kpi_status = "failed"
            pm.kpi_error = str(exc)[:1000]
            pm.kpi_generated_at = _now()
            db.commit()


def generate_kpis(db: Session, project_id: int, member_ids: list[int]) -> None:
    """Generate KPIs for the given members sequentially."""
    for mid in member_ids:
        generate_member_kpi(db, project_id, mid)
