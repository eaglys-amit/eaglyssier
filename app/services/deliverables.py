"""Generate project deliverables from all tasks + all repository summaries.

Produces `Deliverable` rows (source="ai") that also flow into generated reports.
Reuses the shared analyzer abstraction and the project's configured provider/model.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.models import Deliverable, GitRepo, Project, Task
from app.services import analyzers

_MAX_TASKS = 300

_PROMPT = """\
You are compiling the concrete DELIVERABLES of a software project — the tangible \
features, components, documents, and infrastructure that were produced — based on \
the completed/active work below. Group related tasks into meaningful deliverables \
(not one per task). Ground everything in the data; do not invent scope.

Repository summaries:
{summaries}

Tasks (status · story points · key · title):
{tasks}

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"deliverables": [
  {{"name": "short deliverable name",
    "description": "1-2 sentence description of what was delivered",
    "status": "done | in_progress | planned",
    "linked_task_keys": ["ABC-1", "ABC-2"]}}
]}}
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _summaries_text(db: Session, project_id: int) -> str:
    repos = db.execute(
        select(GitRepo).where(GitRepo.project_id == project_id)
    ).scalars().all()
    lines: list[str] = []
    for r in repos:
        if r.summary_status == "ready" and isinstance(r.summary, dict):
            s = r.summary
            lines.append(f"- {r.name}: {s.get('overview', '').strip()}")
            for h in (s.get("highlights") or [])[:6]:
                lines.append(f"    • {h}")
        else:
            lines.append(f"- {r.name}: (no summary generated yet)")
    return "\n".join(lines) or "(no repositories)"


def _tasks_text(db: Session, project_id: int) -> str:
    rows = db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .options(selectinload(Task.sprint))
        .order_by(Task.external_key)
    ).scalars().all()
    lines: list[str] = []
    for t in rows[:_MAX_TASKS]:
        cat = t.status_category.value if t.status_category else "todo"
        sp = t.story_points if t.story_points is not None else 0
        lines.append(f"- {cat} · {sp:g}sp · {t.external_key} · {(t.title or '')[:120]}")
    return "\n".join(lines) or "(no tasks)"


def generate_deliverables(db: Session, project_id: int) -> None:
    """Generate deliverables for a project and persist them. Never raises."""
    project = db.get(Project, project_id)
    if project is None:
        return

    project.deliverables_status = "running"
    project.deliverables_error = None
    db.commit()

    try:
        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(provider, config={"model": project.analysis_model})

        prompt = _PROMPT.format(
            summaries=_summaries_text(db, project_id),
            tasks=_tasks_text(db, project_id),
        )
        result = analyzer.analyze(prompt)
        items = (result.data or {}).get("deliverables") if isinstance(result.data, dict) else None
        if not isinstance(items, list):
            raise RuntimeError("Model did not return a 'deliverables' list.")

        # Replace previously AI-generated deliverables; keep any manual/seed ones.
        db.execute(
            delete(Deliverable).where(
                Deliverable.project_id == project_id, Deliverable.source == "ai"
            )
        )
        for it in items:
            if not isinstance(it, dict) or not it.get("name"):
                continue
            keys = it.get("linked_task_keys") or []
            db.add(
                Deliverable(
                    project_id=project_id,
                    name=str(it["name"])[:512],
                    description=(it.get("description") or None),
                    status=(it.get("status") or "done")[:32],
                    linked_task_keys=[str(k) for k in keys] if isinstance(keys, list) else [],
                    source="ai",
                )
            )

        project.deliverables_model = result.model
        project.deliverables_status = "ready"
        project.deliverables_error = None
        project.deliverables_generated_at = _now()
        db.commit()
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        db.rollback()
        project = db.get(Project, project_id)
        if project is not None:
            project.deliverables_status = "failed"
            project.deliverables_error = str(exc)[:1000]
            project.deliverables_generated_at = _now()
            db.commit()
