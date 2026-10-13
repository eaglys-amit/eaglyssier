"""Executive report: outcome-first summary for product leadership.

Built on the standard report context (app.services.metrics) for the period's
delivery numbers, plus current state from the Portfolio row (health, active
sprint, velocity) and the roadmap forecast. One LLM call turns that data into a
headline, business-language "what shipped", risks and decisions needed; if the
provider fails or isn't set up, the report still renders from the data alone.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Project, StatusCategory, Task
from app.schemas.report import (
    ExecNarrative,
    ExecRisk,
    ExecutiveSection,
    ReportContext,
    ShippedTask,
)
from app.services import analyzers
from app.services import milestones as milestones_svc
from app.services import spec_verify
from app.services import tasks as tasks_svc
from app.services.burndown import build_velocity
from app.services.metrics import _resolve_scope, build_report_context
from app.services.portfolio import build_project_row

log = logging.getLogger(__name__)

SHIPPED_SHOWN = 15     # finished tasks listed when there's no narrative
SHIPPED_PROMPTED = 80  # finished tasks offered to the model
MAX_ITEMS = 6          # per narrative list, so the report stays one page-ish

_PROMPT = """\
You are writing the executive summary of a software project status report for a \
VP of Product. Write for a business reader: outcomes and customer/product impact, \
not implementation detail. Ground every statement in the data below; do not invent \
features, dates or numbers. Be concise.

Project: {project}
Reporting period: {period}

Current health: {health}
Health reasons: {reasons}

Delivery in the period: {completed_sp} of {assigned_sp} story points done \
({tasks_done} of {total_tasks} tasks).
Active sprint: {sprint}
Velocity: {velocity}

Specification coverage: {spec_coverage}

Open milestones (milestone · target · forecast P50–P85 · chance on time · health):
{milestones}
Milestones already complete: {milestones_done}

Deliverables recorded:
{deliverables}

Finished work in the period (key · points · epic · title):
{shipped}

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"headline": "one sentence on where the project stands",
  "shipped": ["up to {n} bullets: what was delivered, in business terms"],
  "risks": [{{"risk": "...", "impact": "what it threatens", "mitigation": "suggested action"}}],
  "decisions": ["up to {n} decisions or input needed from product leadership; [] if none"]}}
"""


def _epic_title(task: Task) -> str | None:
    root = task
    seen = 0
    while root.parent is not None and seen < 10:  # guard against a cycle
        root = root.parent
        seen += 1
    return root.title if root is not task else None


def _shipped(db: Session, project_id: int, scope: dict) -> list[ShippedTask]:
    tasks = [t for t in _resolve_scope(db, project_id, scope).tasks
             if t.status_category == StatusCategory.done]
    tasks.sort(key=lambda t: (-(t.story_points or 0), t.id))
    return [
        ShippedTask(key=tasks_svc.task_label(t), title=t.title or "", story_points=t.story_points,
                    epic=_epic_title(t))
        for t in tasks
    ]


def _pct(p: float | None) -> str:
    return f"{round(p * 100)}%" if p is not None else "n/a"


def _prompt(ctx: ReportContext, ex: ExecutiveSection) -> str:
    row = ex.portfolio
    sprint = row.get("active_sprint")
    sprint_text = (
        f"{sprint['name']}: {sprint['completed_points']:g}/{sprint['total_points']:g} points done"
        + (f", scope {round(sprint['scope_change'] * 100):+d}% since start"
           if sprint.get("scope_change") is not None else "")
        if sprint else "none"
    )
    trend = row.get("velocity_trend")
    velocity = f"{row['velocity_rolling3']:g} points/sprint over the last 3 sprints" + (
        f" ({round(trend * 100)}% of the long-run average)" if trend is not None else ""
    )
    milestones = "\n".join(
        f"- {m['name']} · {m.get('target_date') or 'no target'} · "
        f"{m.get('forecast_p50') or 'n/a'}–{m.get('forecast_p85') or 'n/a'} · "
        f"{'target already passed' if m['health'] == 'overdue' else _pct(m.get('on_time_probability'))}"
        f" · {m['health']}"
        for m in ex.milestones
    ) or "(no milestones)"
    deliverables = "\n".join(
        f"- [{d.status}] {d.name}: {d.description or ''}" for d in ctx.deliverables
    ) or "(none)"
    shipped = "\n".join(
        f"- {t.key} · {t.story_points or 0:g} · {t.epic or '-'} · {t.title[:120]}"
        for t in ex.shipped[:SHIPPED_PROMPTED]
    ) or "(nothing finished in the period)"
    return _PROMPT.format(
        project=ctx.project.name,
        period=ctx.scope_label or "whole project to date",
        health=row["health"],
        reasons="; ".join(row["health_reasons"]) or "none",
        completed_sp=ctx.summary.completed_sp,
        assigned_sp=ctx.summary.assigned_sp,
        tasks_done=ctx.summary.tasks_done,
        total_tasks=ctx.summary.total_tasks,
        sprint=sprint_text,
        velocity=velocity,
        spec_coverage=_spec_line(ex),
        milestones=milestones,
        milestones_done=ex.milestones_done,
        deliverables=deliverables if ex.whole_project else "(see finished work below)",
        shipped=shipped,
        n=MAX_ITEMS,
    )


def _spec_line(ex: ExecutiveSection) -> str:
    cov = ex.spec_coverage
    if not cov:
        return "no specs are tracked"
    line = (f"{cov['implemented']} of {cov['total']} requirements implemented, "
            f"{cov['verified']} verified, {cov['total'] - cov['linked']} with no work linked")
    if ex.spec_gaps:
        line += "; must-haves with no work: " + ", ".join(
            f"{g['key']} {g['title']} ({g['spec']})" for g in ex.spec_gaps)
    return line


def _strings(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()][:MAX_ITEMS]


def parse_narrative(data: dict) -> ExecNarrative:
    """Validate the model's JSON, dropping malformed items rather than failing."""
    if not isinstance(data, dict) or not str(data.get("headline") or "").strip():
        raise analyzers.AnalyzerError("Model returned no headline.")
    risks = []
    for r in data.get("risks") or []:
        if isinstance(r, dict) and str(r.get("risk") or "").strip():
            risks.append(ExecRisk(
                risk=str(r["risk"]).strip(),
                impact=(str(r.get("impact")).strip() or None) if r.get("impact") else None,
                mitigation=(str(r.get("mitigation")).strip() or None)
                if r.get("mitigation") else None,
            ))
    return ExecNarrative(
        headline=str(data["headline"]).strip(),
        shipped=_strings(data.get("shipped")),
        risks=risks[:MAX_ITEMS],
        decisions=_strings(data.get("decisions")),
    )


def _narrate(project: Project, ctx: ReportContext, ex: ExecutiveSection) -> None:
    try:
        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(provider, config={"model": project.analysis_model})
        result = analyzer.analyze(_prompt(ctx, ex))
        ex.narrative = parse_narrative(result.data)
        ex.narrative_model = result.model
    except Exception as exc:  # noqa: BLE001 - the report must render without its prose
        log.warning("Executive narrative failed for project %s: %s", project.id, exc)
        ex.narrative_error = str(exc)[:300] or exc.__class__.__name__


def build_executive_context(
    db: Session, project_id: int, scope: dict, *, narrate: bool = True
) -> ReportContext:
    """The standard context for `scope`, retitled, plus the executive section."""
    ctx = build_report_context(db, project_id, scope)
    project = db.get(Project, project_id)

    velocity = build_velocity(db, project_id)
    roadmap = milestones_svc.build_roadmap(db, project_id, velocity=velocity)
    row = build_project_row(db, project, role=None)
    shipped = _shipped(db, project_id, scope)

    live = [m for m in roadmap.milestones if m.state != "cancelled"]
    done = [m for m in live if m.health == "complete"]
    ex = ExecutiveSection(
        portfolio=json.loads(row.model_dump_json()),
        milestones=[json.loads(m.model_dump_json()) for m in live if m.health != "complete"],
        milestones_done=len(done),
        whole_project=not any(scope.get(k) for k in ("sprint_ids", "sprint_id", "start", "end")),
        shipped=shipped[:SHIPPED_SHOWN],
        shipped_more=max(0, len(shipped) - SHIPPED_SHOWN),
    )
    coverage, spec_rows, _ = spec_verify.project_coverage(db, project_id)
    if coverage is not None:
        ex.spec_coverage = coverage.model_dump()
        ex.spec_rows = [r.model_dump() for r in spec_rows]
        ex.spec_gaps = spec_verify.must_gaps(db, project_id)
    ctx.executive = ex
    if narrate:
        # The prompt sees the full list, not just what the fallback shows.
        full = ex.model_copy(update={"shipped": shipped})
        _narrate(project, ctx, full)
        ex.narrative, ex.narrative_error, ex.narrative_model = (
            full.narrative, full.narrative_error, full.narrative_model
        )

    ctx.report_type = "executive"
    ctx.title = f"{project.name} — Executive Summary"
    return ctx
