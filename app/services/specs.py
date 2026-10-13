"""Specs and requirements: extraction, versions, status, coverage, task links.

A document spec is created from an uploaded reference file. Extraction (one
LLM call) turns its text into requirements; uploading a revised file runs the
same extraction and then compares the result with the current requirements
(app.services.spec_diff), marking each added, changed, unchanged or removed and
flagging task links whose requirement changed underneath them.

Requirement status is derived from the linked tasks on every read — never
stored — so it can't disagree with the board.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.models import (
    ReferenceFile,
    Requirement,
    RequirementTask,
    Spec,
    SpecRevision,
    StatusCategory,
    Task,
)
from app.schemas.spec import (
    AcceptanceCriterion,
    Coverage,
    LinkedTask,
    RequirementOut,
    SpecDetail,
    SpecRevisionOut,
    SpecSummary,
    RequirementBrief,
    TaskRequirement,
)
from app.services import analyzers
from app.services import references as refs
from app.services import spec_diff
from app.services import tasks as tasks_svc

log = logging.getLogger(__name__)

MAX_REQUIREMENTS = 300
_KINDS = {"functional", "non_functional", "user_story", "constraint"}
_PRIORITIES = {"must", "should", "could"}

_PROMPT = """\
You are extracting the REQUIREMENTS from a software specification so that \
delivery can be tracked against each one. Extract every distinct, testable \
requirement: functional requirements, non-functional requirements (performance, \
security, availability…), user stories, and hard constraints. Do not invent \
requirements; do not merge unrelated ones; skip background, rationale and \
open questions.

For each requirement:
- key: the identifier the document itself uses (e.g. "FR-001", "REQ-12", "4.2", \
"US1"), or null if the document doesn't number it.
- title: a short name (max ~10 words).
- statement: the requirement as one clear sentence ("The system must …").
- kind: functional | non_functional | user_story | constraint
- priority: must | should | could, only if the document states or clearly \
implies it (MUST/SHOULD/MAY, P0/P1…); otherwise null.
- acceptance_criteria: the document's acceptance criteria / scenarios for it, \
as a list of short strings; [] if none are given.
- source_excerpt: the sentence(s) it comes from, copied VERBATIM from the \
document (max ~400 characters). This is used to detect changes between \
versions, so copy exactly; do not paraphrase.

Specification:
{document}

Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{"requirements": [
  {{"key": "FR-001", "title": "...", "statement": "...", "kind": "functional",
    "priority": "must", "acceptance_criteria": ["..."], "source_excerpt": "..."}}
]}}
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def text_hash(text: str) -> str:
    return hashlib.sha256(re.sub(r"\s+", " ", text).strip().encode()).hexdigest()


# ------------------------------------------------------------------ lookups


def get_spec_or_404(db: Session, spec_id: int) -> Spec:
    spec = db.get(Spec, spec_id)
    if spec is None:
        raise HTTPException(404, "Spec not found")
    return spec


def get_requirement_or_404(db: Session, requirement_id: int) -> Requirement:
    req = db.get(Requirement, requirement_id)
    if req is None:
        raise HTTPException(404, "Requirement not found")
    return req


def _require_editable(spec: Spec) -> None:
    if spec.source != "document":
        raise HTTPException(
            409, "This spec is synced from its repository; change it there and re-sync."
        )


# ---------------------------------------------------------- status/coverage


def requirement_status(req: Requirement, tasks: list[Task]) -> str:
    if req.change_state == "removed":
        return "removed"
    if not tasks:
        return "untraced"
    done = [t.status_category == StatusCategory.done for t in tasks]
    if all(done):
        criteria = req.acceptance_criteria or []
        if criteria and all(c.get("verified") for c in criteria):
            return "verified"
        return "implemented"
    if any(done) or any(t.status_category == StatusCategory.in_progress for t in tasks):
        return "in_progress"
    return "planned"


def coverage_of(rows: list[tuple[Requirement, str, bool]]) -> Coverage:
    """rows: (requirement, status, has a link needing review)."""
    cov = Coverage()
    for req, status, review in rows:
        if status == "removed":
            continue
        cov.total += 1
        cov.linked += status != "untraced"
        cov.implemented += status in ("implemented", "verified")
        cov.verified += status == "verified"
        cov.changed += req.change_state in ("added", "changed")
        cov.needs_review += review
    return cov


def _requirement_rows(spec: Spec) -> list[tuple[Requirement, str, bool]]:
    out = []
    for req in spec.requirements:
        tasks = [link.task for link in req.task_links]
        out.append((req, requirement_status(req, tasks),
                    any(link.needs_review for link in req.task_links)))
    return out


def _load(db: Session, spec_ids: list[int]) -> list[Spec]:
    return list(db.execute(
        select(Spec)
        .where(Spec.id.in_(spec_ids or [-1]))
        .options(
            selectinload(Spec.reference_file),
            selectinload(Spec.requirements)
            .selectinload(Requirement.task_links)
            .selectinload(RequirementTask.task),
        )
    ).scalars().all())


def _summary(spec: Spec, rows) -> dict:
    return dict(
        id=spec.id,
        title=spec.title,
        source=spec.source,
        status=spec.status,
        version=spec.version,
        extract_status=spec.extract_status,
        extract_error=spec.extract_error,
        extract_model=spec.extract_model,
        reference_file_id=spec.reference_file_id,
        filename=spec.reference_file.filename if spec.reference_file else spec.path,
        has_pending_version=spec.pending_file_id is not None and spec.version > 0,
        coverage=coverage_of(rows),
        updated_at=spec.updated_at,
    )


def list_specs(db: Session, project_id: int) -> list[SpecSummary]:
    ids = db.execute(
        select(Spec.id).where(Spec.project_id == project_id).order_by(Spec.title)
    ).scalars().all()
    specs = sorted(_load(db, list(ids)), key=lambda s: s.title.lower())
    return [SpecSummary(**_summary(s, _requirement_rows(s))) for s in specs]


def _criteria(raw: list) -> list[AcceptanceCriterion]:
    return [AcceptanceCriterion(**c) for c in raw or [] if isinstance(c, dict) and c.get("text")]


def spec_detail(db: Session, spec_id: int) -> SpecDetail:
    (spec,) = _load(db, [spec_id]) or [None]
    if spec is None:
        raise HTTPException(404, "Spec not found")
    rows = _requirement_rows(spec)
    revisions = db.execute(
        select(SpecRevision).where(SpecRevision.spec_id == spec.id)
        .order_by(SpecRevision.version.desc())
    ).scalars().all()
    return SpecDetail(
        **_summary(spec, rows),
        requirements=[
            RequirementOut(
                id=req.id, key=req.key, key_origin=req.key_origin, title=req.title,
                statement=req.statement, kind=req.kind, priority=req.priority,
                acceptance_criteria=_criteria(req.acceptance_criteria),
                source_excerpt=req.source_excerpt, change_state=req.change_state,
                changed_in_version=req.changed_in_version, status=status,
                tasks=[
                    LinkedTask(
                        task_id=link.task.id, key=tasks_svc.task_label(link.task),
                        title=link.task.title, status=link.task.status,
                        status_category=link.task.status_category.value,
                        origin=link.origin, needs_review=link.needs_review,
                    )
                    for link in sorted(req.task_links, key=lambda lk: lk.task_id)
                ],
            )
            for req, status, _ in rows
        ],
        revisions=[
            SpecRevisionOut(version=r.version, created_at=r.created_at, changes=r.changes or {})
            for r in revisions
        ],
    )


def project_requirements(db: Session, project_id: int) -> list[RequirementBrief]:
    rows = db.execute(
        select(Requirement, Spec.title)
        .join(Spec, Spec.id == Requirement.spec_id)
        .where(Spec.project_id == project_id, Requirement.change_state != "removed")
        .order_by(Spec.title, Requirement.rank, Requirement.id)
    ).all()
    return [
        RequirementBrief(id=r.id, key=r.key, title=r.title, spec_id=r.spec_id,
                         spec_title=title, change_state=r.change_state)
        for r, title in rows
    ]


def task_requirements(db: Session, task_id: int) -> list[TaskRequirement]:
    links = db.execute(
        select(RequirementTask)
        .where(RequirementTask.task_id == task_id)
        .options(
            selectinload(RequirementTask.requirement).selectinload(Requirement.spec),
            selectinload(RequirementTask.requirement)
            .selectinload(Requirement.task_links)
            .selectinload(RequirementTask.task),
        )
    ).scalars().all()
    out = []
    for link in links:
        req = link.requirement
        out.append(TaskRequirement(
            requirement_id=req.id, spec_id=req.spec_id, spec_title=req.spec.title,
            key=req.key, title=req.title,
            status=requirement_status(req, [lk.task for lk in req.task_links]),
            needs_review=link.needs_review, origin=link.origin,
        ))
    return sorted(out, key=lambda r: (r.spec_title, r.key))


# ------------------------------------------------------------ create/version


def create_document_spec(db: Session, project_id: int, file_id: int, title: str | None) -> Spec:
    file = db.get(ReferenceFile, file_id)
    if file is None or file.project_id != project_id:
        raise HTTPException(404, "Document not found in this project")
    if not (file.extracted_text or "").strip():
        raise HTTPException(400, "That document has no extracted text to read requirements from.")
    spec = Spec(
        project_id=project_id,
        title=(title or "").strip() or re.sub(r"\.[A-Za-z0-9]+$", "", file.filename),
        source="document",
        pending_file_id=file.id,
    )
    db.add(spec)
    db.commit()
    db.refresh(spec)
    return spec


def stage_new_version(db: Session, spec: Spec, file: ReferenceFile) -> None:
    _require_editable(spec)
    spec.pending_file_id = file.id
    db.commit()


def claim_extraction(db: Session, spec: Spec) -> bool:
    """Atomically flip to running; False if an extraction is already running."""
    claimed = db.execute(
        update(Spec)
        .where(Spec.id == spec.id, Spec.extract_status != "running")
        .values(extract_status="running", extract_error=None)
    )
    db.commit()
    db.refresh(spec)
    return claimed.rowcount > 0


def _str(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def parse_requirements(data: dict) -> list[spec_diff.Parsed]:
    """Validate the model's JSON; drop malformed items rather than fail."""
    items = data.get("requirements") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise analyzers.AnalyzerError("Model did not return a 'requirements' list.")
    out: list[spec_diff.Parsed] = []
    for it in items[:MAX_REQUIREMENTS]:
        if not isinstance(it, dict):
            continue
        title = _str(it.get("title"), 512)
        statement = _str(it.get("statement"), 4000)
        if not (title or statement):
            continue
        key = spec_diff.normalize_key(it.get("key")) if it.get("key") else None
        kind = it.get("kind") if it.get("kind") in _KINDS else "functional"
        priority = it.get("priority") if it.get("priority") in _PRIORITIES else None
        criteria = it.get("acceptance_criteria")
        out.append(spec_diff.Parsed(
            key=key,
            key_from_document=key is not None,
            title=title or statement[:120],
            statement=statement or title,
            kind=kind,
            priority=priority,
            acceptance_criteria=[
                _str(c, 1000) for c in (criteria if isinstance(criteria, list) else [])
                if _str(c, 1000)
            ][:30],
            source_excerpt=_str(it.get("source_excerpt"), 2000) or None,
        ))
    if not out:
        raise analyzers.AnalyzerError("No requirements were found in the document.")
    # Duplicate document keys: keep the first, let the rest be renumbered.
    seen: set[str] = set()
    for p in out:
        if p.key and p.key in seen:
            p.key, p.key_from_document = None, False
        elif p.key:
            seen.add(p.key)
    return out


def _merge_criteria(old: list, new_texts: list[str]) -> list[dict]:
    """New criteria list; keeps verification on criteria whose text is unchanged."""
    verified = {
        spec_diff._norm(c.get("text")): c for c in old or []
        if isinstance(c, dict) and c.get("verified")
    }
    return [
        verified.get(spec_diff._norm(t)) or {"text": t, "verified": False,
                                              "verified_by": None, "verified_at": None}
        for t in new_texts
    ]


def apply_version(
    db: Session,
    spec: Spec,
    parsed: list[spec_diff.Parsed],
    *,
    text: str,
    file_id: int | None,
) -> dict[str, int]:
    """Make `parsed` the spec's next version. Returns the added/changed/removed counts."""
    existing = list(spec.requirements)
    by_id = {r.id: r for r in existing}
    plan = spec_diff.plan_version(
        [
            spec_diff.Existing(
                id=r.id, key=r.key, key_origin=r.key_origin, statement=r.statement,
                source_excerpt=r.source_excerpt,
                acceptance_criteria=[c.get("text", "") for c in r.acceptance_criteria or []],
                change_state=r.change_state,
            )
            for r in existing
        ],
        parsed,
    )
    version = spec.version + 1
    first = spec.version == 0
    order = {id(p): i for i, p in enumerate(parsed)}

    # Every requirement starts the version unmarked; the plan re-marks what moved.
    for r in existing:
        if r.change_state != "removed":
            r.change_state = "unchanged"

    for m in plan.matches:
        req, p = by_id[m.existing_id], m.parsed
        was_removed = req.change_state == "removed"
        req.title, req.statement = p.title, p.statement
        req.kind, req.priority = p.kind, p.priority
        req.source_excerpt = p.source_excerpt
        req.acceptance_criteria = _merge_criteria(req.acceptance_criteria, p.acceptance_criteria)
        req.rank = order[id(p)]
        if p.key_from_document:
            req.key_origin = "document"
        if m.changed or was_removed:
            req.change_state = "added" if was_removed else "changed"
            req.changed_in_version = version
            for link in req.task_links:
                link.needs_review = True

    for key, p in plan.added:
        db.add(Requirement(
            spec_id=spec.id, key=key,
            key_origin="document" if p.key_from_document and key == p.key else "generated",
            title=p.title, statement=p.statement, kind=p.kind, priority=p.priority,
            acceptance_criteria=_merge_criteria([], p.acceptance_criteria),
            source_excerpt=p.source_excerpt, rank=order[id(p)],
            # The first version is the baseline, not a list of additions.
            change_state="unchanged" if first else "added",
            changed_in_version=None if first else version,
        ))

    for eid in plan.removed:
        req = by_id[eid]
        req.change_state = "removed"
        req.changed_in_version = version
        req.rank = MAX_REQUIREMENTS + req.rank
        for link in req.task_links:
            link.needs_review = True

    counts = plan.counts()
    if first:
        counts = {"added": len(parsed), "changed": 0, "removed": 0}
    spec.version = version
    spec.content_hash = text_hash(text)
    if file_id is not None:
        spec.reference_file_id = file_id
    db.add(SpecRevision(spec_id=spec.id, version=version, content_hash=spec.content_hash,
                        text=text, reference_file_id=file_id, changes=counts))
    return counts


def extract_document_spec(db: Session, spec_id: int) -> None:
    """Background job: read the pending (or current) file and apply it. Never raises."""
    spec = db.get(Spec, spec_id)
    if spec is None:
        return
    try:
        file_id = spec.pending_file_id or spec.reference_file_id
        file = db.get(ReferenceFile, file_id) if file_id else None
        text = (file.extracted_text or "") if file else ""
        if not text.strip():
            raise analyzers.AnalyzerError("The document has no extracted text.")

        if spec.version and text_hash(text) == spec.content_hash:
            # Same words as the current version: nothing to re-extract.
            spec.pending_file_id = None
            spec.reference_file_id = file.id
            spec.extract_status = "ready"
            db.commit()
            return

        document = refs.documents_text(db, [file.id], budget=settings.breakdown_max_prompt_chars)
        project = spec.project
        provider = project.analysis_provider or settings.default_analysis_provider
        analyzer = analyzers.get_analyzer(provider, config={"model": project.analysis_model})
        result = analyzer.analyze(_PROMPT.format(document=document))
        parsed = parse_requirements(result.data)

        apply_version(db, spec, parsed, text=text, file_id=file.id)
        spec.pending_file_id = None
        spec.extract_status = "ready"
        spec.extract_error = None
        spec.extract_model = result.model
        spec.synced_at = _now()
        db.commit()
    except Exception as exc:  # noqa: BLE001 - failures land on the row
        db.rollback()
        log.warning("Spec %s extraction failed: %s", spec_id, exc)
        spec = db.get(Spec, spec_id)
        if spec is not None:
            spec.extract_status = "failed"
            spec.extract_error = str(exc)[:2000] or exc.__class__.__name__
            db.commit()


# ------------------------------------------------------------- manual edits


def _next_generated_key(spec: Spec) -> str:
    nums = [int(m.group(1)) for r in spec.requirements
            if (m := re.match(r"^R-(\d+)$", r.key))]
    return f"R-{max(nums, default=0) + 1}"


def add_requirement(db: Session, spec: Spec, data) -> Requirement:
    _require_editable(spec)
    key = spec_diff.normalize_key(data.key) if data.key else _next_generated_key(spec)
    if any(r.key == key for r in spec.requirements):
        raise HTTPException(409, f"{key} already exists in this spec")
    req = Requirement(
        spec_id=spec.id, key=key, key_origin="manual", title=data.title.strip(),
        statement=data.statement.strip(), kind=data.kind, priority=data.priority,
        acceptance_criteria=_merge_criteria([], [c.strip() for c in data.acceptance_criteria
                                                 if c.strip()]),
        rank=max((r.rank for r in spec.requirements), default=-1) + 1,
        change_state="unchanged",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def patch_requirement(db: Session, req: Requirement, data) -> None:
    _require_editable(req.spec)
    if data.title is not None:
        req.title = data.title.strip()
    if data.statement is not None:
        req.statement = data.statement.strip()
    if data.kind is not None:
        req.kind = data.kind
    if data.clear_priority:
        req.priority = None
    elif data.priority is not None:
        req.priority = data.priority
    if data.acceptance_criteria is not None:
        req.acceptance_criteria = _merge_criteria(
            req.acceptance_criteria, [c.strip() for c in data.acceptance_criteria if c.strip()]
        )
    db.commit()


def delete_requirement(db: Session, req: Requirement) -> None:
    _require_editable(req.spec)
    db.delete(req)
    db.commit()


# -------------------------------------------------------------------- links


def link_task(db: Session, req: Requirement, task_id: int, origin: str = "manual") -> None:
    task = db.get(Task, task_id)
    if task is None or task.project_id != req.spec.project_id:
        raise HTTPException(404, "Task not found in this project")
    exists = db.execute(
        select(RequirementTask).where(
            RequirementTask.requirement_id == req.id, RequirementTask.task_id == task_id
        )
    ).scalar_one_or_none()
    if exists is None:
        db.add(RequirementTask(requirement_id=req.id, task_id=task_id, origin=origin))
        db.commit()


def _link_or_404(db: Session, req: Requirement, task_id: int) -> RequirementTask:
    link = db.execute(
        select(RequirementTask).where(
            RequirementTask.requirement_id == req.id, RequirementTask.task_id == task_id
        )
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(404, "That task isn't linked to this requirement")
    return link


def unlink_task(db: Session, req: Requirement, task_id: int) -> None:
    db.delete(_link_or_404(db, req, task_id))
    db.commit()


def mark_reviewed(db: Session, req: Requirement, task_id: int) -> None:
    _link_or_404(db, req, task_id).needs_review = False
    db.commit()
