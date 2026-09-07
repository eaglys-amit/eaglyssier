"""Per-repository documentation sets: the template, the tree, and the bytes.

Every repository can carry a standard set of lifecycle documents — a PRD, an API
contract, a roadmap, a dependency/license review, a test plan, a security
assessment, a CI/CD runbook, release notes — filed in four numbered folders and
written by the analysis provider. This module owns everything except the model
call itself, which lives in app.services.repo_doc_gen.

The tree is a DB concern only. Storage keys are
``repo-docs/{repo_id}/{doc_id}/{safe_filename(title)}.md`` and folder names are
deliberately not part of them, so renaming or re-filing a document never touches
storage. The key is computed at the first write and then never rewritten, not
even on rename: ``RepoDoc.storage_key`` is the truth and the path is only a
debugging hint. Rewriting it would mean a put + delete pair with a window in
which a crash loses the only copy, to make a path prettier that nothing reads.

The folder helpers are the ones from app.services.references, applied to a
second tree: the same ``reparent`` flag, the same case-insensitive sibling-name
check in Python rather than a UniqueConstraint, and the same cycle guard. See
that module for why each is shaped the way it is.
"""
from __future__ import annotations

import io
import logging
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import GitRepo, RepoDoc, RepoDocFolder
from app.services import references as refs
from app.storage import rustfs

log = logging.getLogger("app.services.repo_docs")

_CONTENT_TYPE = "text/markdown; charset=utf-8"

# Sparse spacing, as app.services.tasks does, so a row can be inserted between
# two others without renumbering the set.
RANK_STEP = 1000

# Guard the parent-walk in folder_path against a cycle the DB can't prevent
# (nothing stops a hand-written UPDATE), matching folder-tree.ts's depth cap.
_MAX_DEPTH = 64

# Which evidence blocks a document may ask build_context for. Anything else in
# context_kinds is dropped rather than trusted, since the model writes this
# field for suggested documents.
CONTEXT_KINDS = frozenset(
    {"summary", "commits", "files", "prs", "sprints", "tasks", "milestones"}
)


class DocError(HTTPException):
    """An invalid folder/document operation — bad name, bad parent, or a cycle."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------- template


@dataclass(frozen=True)
class _TemplateDoc:
    key: str
    title: str
    context_kinds: tuple[str, ...]
    guidance: str
    diagrams: str


@dataclass(frozen=True)
class _TemplateFolder:
    key: str
    name: str
    docs: tuple[_TemplateDoc, ...]


# The built-in set, in lifecycle order. `guidance` is seeded onto the row rather
# than looked up at generation time, because it has to be editable by hand and
# the suggestion flow has to be able to write it — a second copy in code would
# only be a consistency bug waiting to happen. `diagrams` is folded into the
# same column for the same reason: both answer "what must this document
# contain?".
TEMPLATE: tuple[_TemplateFolder, ...] = (
    _TemplateFolder(
        key="01_requirements_design",
        name="01_Requirements_&_Design",
        docs=(
            _TemplateDoc(
                key="product_requirement_document",
                title="Product_Requirement_Document",
                context_kinds=("summary", "tasks", "milestones"),
                guidance=(
                    "Why this software exists and what it must do. Cover: the problem and "
                    "who has it; the intended users and how they consume it; goals and "
                    "explicit non-goals; the supported runtimes/platforms; numbered "
                    "functional requirements written as user stories with acceptance "
                    "criteria; and an 'Out of scope' section. There is no UI to mock up, so "
                    "the requirement list and its acceptance criteria are the specification."
                ),
                diagrams="one `flowchart` of the primary user journey, or none if it adds nothing.",
            ),
            _TemplateDoc(
                key="api_design_specs",
                title="API_Design_Specs",
                context_kinds=("summary", "commits", "files", "prs"),
                guidance=(
                    "The contract this software offers its callers, as it actually stands. "
                    "Inventory the public surface grouped by resource or module — names, "
                    "parameters, return shapes, errors raised. Then cover authentication, "
                    "the error model, versioning and deprecation policy, and any backwards "
                    "compatibility guarantees. Name what you could not determine from the "
                    "evidence rather than guessing at a signature."
                ),
                diagrams=(
                    "a `sequenceDiagram` for each non-trivial flow (authentication, the main "
                    "write path) and an `erDiagram` of the resources and their relationships."
                ),
            ),
            _TemplateDoc(
                key="competitor_analysis",
                title="Competitor_Analysis",
                context_kinds=("summary",),
                guidance=(
                    "Why this was built rather than adopted. Identify the closest existing "
                    "alternatives, compare them feature by feature in a table, and state the "
                    "unique value this provides. The repository evidence says almost nothing "
                    "about competitors, so most of this is necessarily assumption — put it "
                    "under '## Assumptions' and label it, and prefer naming the gaps to "
                    "inventing a comparison."
                ),
                diagrams="none — a comparison table is clearer than a diagram here.",
            ),
        ),
    ),
    _TemplateFolder(
        key="02_project_management",
        name="02_Project_Management",
        docs=(
            _TemplateDoc(
                key="project_roadmap_milestones",
                title="Project_Roadmap_&_Milestones",
                context_kinds=("summary", "sprints", "milestones", "tasks"),
                guidance=(
                    "What ships when. Group the work into Alpha, Beta and Stable (v1.0.0) "
                    "using the real sprints and milestones in the evidence, with the actual "
                    "dates and the actual state of each. Say what is already done, what is in "
                    "flight, and what has not started. Do not invent dates the evidence does "
                    "not carry — an undated milestone is 'unscheduled'."
                ),
                diagrams=(
                    "a `gantt` built strictly from the sprint and milestone dates in the "
                    "evidence. Use `dateFormat YYYY-MM-DD`. Omit the diagram entirely rather "
                    "than inventing dates for it."
                ),
            ),
            _TemplateDoc(
                key="dependency_license_review",
                title="Dependency_&_License_Review",
                context_kinds=("summary", "files", "commits"),
                guidance=(
                    "The third-party code this depends on and what it obliges. For each "
                    "dependency you can identify from the evidence: what it is used for, its "
                    "license, and whether that license is compatible with this project's. "
                    "Then cover supply-chain risk (unmaintained or single-maintainer "
                    "packages) and package weight. The evidence holds touched file paths, not "
                    "manifests, so state plainly which dependencies you could and could not "
                    "determine — an incomplete list labelled as incomplete is useful; one "
                    "presented as complete is dangerous."
                ),
                diagrams="a `flowchart LR` of the dependency graph, grouped by license family.",
            ),
            _TemplateDoc(
                key="engineering_standards",
                title="Engineering_Standards_&_Workflow",
                context_kinds=("summary", "commits", "prs"),
                guidance=(
                    "How this team actually works, inferred from the history rather than "
                    "aspirationally. Cover branch naming, the review and merge policy, commit "
                    "message conventions, formatting and linting, type checking, and the "
                    "minimum test coverage expected. Where the observed history contradicts a "
                    "stated standard, say so — that gap is the most useful thing in this "
                    "document."
                ),
                diagrams=(
                    "one `gitGraph` or `flowchart` of the branch and review flow actually "
                    "observed in the commit and PR evidence."
                ),
            ),
        ),
    ),
    _TemplateFolder(
        key="03_qa_security",
        name="03_QA_&_Security",
        docs=(
            _TemplateDoc(
                key="test_plan_validation_matrix",
                title="Test_Plan_&_Validation_Matrix",
                context_kinds=("summary", "tasks", "files"),
                guidance=(
                    "How this is verified. Cover the testing strategy by level (unit, "
                    "integration, end-to-end), the required coverage percentage, and how "
                    "cross-platform and cross-version testing is validated. Then give a "
                    "validation matrix as a table mapping each requirement to the tests that "
                    "cover it, with the gaps left visible as gaps."
                ),
                diagrams="a `flowchart` of the test pyramid or of the CI stages that run it.",
            ),
            _TemplateDoc(
                key="security_assessment_report",
                title="Security_Assessment_Report",
                context_kinds=("summary", "commits", "files"),
                guidance=(
                    "The security posture. Cover the trust boundaries and where untrusted "
                    "input enters; handling of secrets and credentials; dependency "
                    "vulnerability tracking; any security-relevant changes visible in the "
                    "commit history; and the process for receiving and responding to a "
                    "reported vulnerability. This is an assessment of what the evidence "
                    "shows, not a certification — say what was not examined."
                ),
                diagrams=(
                    "a `flowchart` of trust boundaries and data flows, marking where "
                    "untrusted input crosses into trusted code."
                ),
            ),
        ),
    ),
    _TemplateFolder(
        key="04_release_delivery",
        name="04_Release_&_Delivery",
        docs=(
            _TemplateDoc(
                key="cicd_deployment_runbook",
                title="CI-CD_Deployment_Runbook",
                context_kinds=("summary", "files", "commits"),
                guidance=(
                    "How a change becomes a published artifact, step by step, concretely "
                    "enough to follow under pressure. Cover how the build produces its "
                    "distributable, how it is versioned and tagged, where it is published and "
                    "with what credentials, how to verify a release landed, and how to roll "
                    "one back. Include the manual steps, not just the automated ones."
                ),
                diagrams="a `flowchart TD` of the pipeline: commit -> build -> test -> artifact -> deploy.",
            ),
            _TemplateDoc(
                key="release_notes",
                title="Release_Notes",
                context_kinds=("commits", "prs", "tasks", "milestones"),
                guidance=(
                    "What changed, for the people who have to consume it. Group into Added, "
                    "Changed, Fixed, Deprecated and Removed. Lead with a '## Breaking "
                    "changes' section stating exactly what callers must rewrite and how — for "
                    "a library that is the single most important part of this document, so "
                    "put it first even if the list is empty ('None'). Draw every entry from "
                    "the commit and PR evidence."
                ),
                diagrams="none — release notes are a list, not a picture.",
            ),
            _TemplateDoc(
                key="beta_developer_feedback",
                title="Beta_Developer_Feedback",
                context_kinds=("summary",),
                guidance=(
                    "What the developers who integrated this first reported. The repository "
                    "holds no feedback data, so produce a usable *skeleton*: the questions to "
                    "ask, a table to record each tester's integration experience and blockers, "
                    "and a section for the decisions that came out of it. Mark every unfilled "
                    "part as an explicit TODO rather than inventing quotes or findings."
                ),
                diagrams="none.",
            ),
        ),
    ),
)

_TEMPLATE_DOCS: dict[str, tuple[_TemplateFolder, _TemplateDoc]] = {
    doc.key: (folder, doc) for folder in TEMPLATE for doc in folder.docs
}


def template_guidance(doc: _TemplateDoc) -> str:
    """The brief plus its diagram instruction, as one stored guidance string."""
    return f"{doc.guidance}\n\nDiagrams: {doc.diagrams}"


# -------------------------------------------------------------------- seeding


def seed_doc_set(db: Session, repo_id: int) -> bool:
    """Create the built-in template for a repo, once. True if this call did it.

    The claim is the same idiom as breakdown.claim(): the UPDATE's own WHERE is
    the lock, so two simultaneous first-opens of the page cannot both seed. The
    marker is a column rather than "does any row carry a template_key", because
    that inference would resurrect a template document the user deliberately
    deleted every time they opened the page.
    """
    claimed = db.execute(
        update(GitRepo)
        .where(GitRepo.id == repo_id)
        .where(GitRepo.docs_seeded_at.is_(None))
        .values(docs_seeded_at=_now())
    )
    db.commit()
    if not claimed.rowcount:
        return False
    _create_template_rows(db, repo_id)
    return True


def restore_missing_template(db: Session, repo_id: int) -> list[RepoDoc]:
    """Re-create template rows that are no longer there, leaving the rest alone.

    Deliberately explicit — it undoes a deletion, so it is a button the user
    presses, never something seed_doc_set does behind their back.
    """
    return _create_template_rows(db, repo_id)


def _create_template_rows(db: Session, repo_id: int) -> list[RepoDoc]:
    """Insert whichever template folders/documents are absent. Idempotent."""
    have_folders = {
        f.template_key: f for f in list_folders(db, repo_id) if f.template_key
    }
    have_docs = {d.template_key for d in list_docs(db, repo_id) if d.template_key}

    created: list[RepoDoc] = []
    doc_rank = _max_rank(db, repo_id)
    for f_index, folder in enumerate(TEMPLATE):
        row = have_folders.get(folder.key)
        if row is None:
            row = RepoDocFolder(
                repo_id=repo_id,
                parent_id=None,
                name=folder.name,
                rank=(f_index + 1) * RANK_STEP,
                source="template",
                template_key=folder.key,
            )
            db.add(row)
            db.flush()
            have_folders[folder.key] = row

        for doc in folder.docs:
            if doc.key in have_docs:
                continue
            doc_rank += RANK_STEP
            created.append(
                RepoDoc(
                    repo_id=repo_id,
                    folder_id=row.id,
                    title=doc.title,
                    rank=doc_rank,
                    source="template",
                    template_key=doc.key,
                    guidance=template_guidance(doc),
                    context_kinds=list(doc.context_kinds),
                    reference_file_ids=[],
                    status="none",
                )
            )
    db.add_all(created)
    db.commit()
    return created


# --------------------------------------------------------------------- reading


def list_folders(db: Session, repo_id: int) -> list[RepoDocFolder]:
    """Every folder in the set, flat. The caller nests them."""
    return list(
        db.execute(
            select(RepoDocFolder)
            .where(RepoDocFolder.repo_id == repo_id)
            .order_by(RepoDocFolder.rank, RepoDocFolder.name)
        )
        .scalars()
        .all()
    )


def list_docs(db: Session, repo_id: int) -> list[RepoDoc]:
    """Every document in the set, flat and in queue order."""
    return list(
        db.execute(
            select(RepoDoc)
            .where(RepoDoc.repo_id == repo_id)
            .order_by(RepoDoc.rank, RepoDoc.id)
        )
        .scalars()
        .all()
    )


def get_repo_or_404(db: Session, repo_id: int) -> GitRepo:
    row = db.get(GitRepo, repo_id)
    if row is None:
        raise DocError(404, "Repository not found")
    return row


def get_folder_or_404(db: Session, repo_id: int, folder_id: int) -> RepoDocFolder:
    row = db.get(RepoDocFolder, folder_id)
    if row is None or row.repo_id != repo_id:
        raise DocError(404, "Folder not found in this documentation set")
    return row


def get_doc_or_404(db: Session, doc_id: int) -> RepoDoc:
    row = db.get(RepoDoc, doc_id)
    if row is None:
        raise DocError(404, "Document not found")
    return row


def _max_rank(db: Session, repo_id: int) -> int:
    return int(
        db.execute(
            select(func.coalesce(func.max(RepoDoc.rank), 0)).where(
                RepoDoc.repo_id == repo_id
            )
        ).scalar()
        or 0
    )


def next_rank(db: Session, repo_id: int) -> int:
    return _max_rank(db, repo_id) + RANK_STEP


def folder_path(
    folders_by_id: dict[int, RepoDocFolder], folder_id: int | None
) -> list[RepoDocFolder]:
    """Root-first chain of folders down to ``folder_id``. Depth-capped."""
    chain: list[RepoDocFolder] = []
    seen: set[int] = set()
    current = folder_id
    while current is not None and len(chain) < _MAX_DEPTH:
        row = folders_by_id.get(current)
        if row is None or row.id in seen:
            break
        seen.add(row.id)
        chain.append(row)
        current = row.parent_id
    chain.reverse()
    return chain


# --------------------------------------------------------------------- naming


def _clean_name(name: str) -> str:
    """Collapse whitespace and strip path separators.

    Separators are stripped rather than rejected for the reason spelled out in
    references._clean_name: a pasted "specs/api" means one folder named that,
    not a silent second level. Storage keys never use folder names, so this is
    purely about the name being honest.
    """
    cleaned = re.sub(r"\s+", " ", name.replace("/", " ").replace("\\", " ")).strip()
    if not cleaned:
        raise DocError(422, "A folder needs a name.")
    return cleaned[:255]


def _clean_title(title: str) -> str:
    cleaned = re.sub(r"\s+", " ", title.replace("/", " ").replace("\\", " ")).strip()
    if not cleaned:
        raise DocError(422, "A document needs a title.")
    return cleaned[:512]


def _assert_folder_name_free(
    db: Session,
    repo_id: int,
    *,
    parent_id: int | None,
    name: str,
    exclude_id: int | None = None,
) -> None:
    """Reject a duplicate sibling folder name, case-insensitively.

    In Python rather than a UniqueConstraint because Postgres treats NULLs as
    distinct, so the constraint would not cover top-level folders — which is
    exactly where an accidental duplicate is most likely.
    """
    clash = next(
        (
            f
            for f in list_folders(db, repo_id)
            if f.parent_id == parent_id
            and f.id != exclude_id
            and f.name.casefold() == name.casefold()
        ),
        None,
    )
    if clash is not None:
        where = "this folder" if parent_id else "the top level"
        raise DocError(409, f'"{clash.name}" already exists in {where}.')


def _assert_title_free(
    db: Session,
    repo_id: int,
    *,
    folder_id: int | None,
    title: str,
    exclude_id: int | None = None,
) -> None:
    """Reject two documents with the same title in one folder.

    Not only cosmetic: build_archive derives filenames from titles, so a
    duplicate would collide inside the .zip.
    """
    clash = next(
        (
            d
            for d in list_docs(db, repo_id)
            if d.folder_id == folder_id
            and d.id != exclude_id
            and d.title.casefold() == title.casefold()
        ),
        None,
    )
    if clash is not None:
        where = "this folder" if folder_id else "the set root"
        raise DocError(409, f'"{clash.title}" already exists in {where}.')


def descendant_ids(folders: list[RepoDocFolder], root_id: int) -> set[int]:
    """root_id plus every folder beneath it."""
    children: dict[int | None, list[int]] = {}
    for f in folders:
        children.setdefault(f.parent_id, []).append(f.id)
    seen = {root_id}
    stack = [root_id]
    while stack:
        for child in children.get(stack.pop(), []):
            if child not in seen:
                seen.add(child)
                stack.append(child)
    return seen


def clean_context_kinds(kinds: object) -> list[str]:
    """Keep only recognised evidence kinds, in a stable order.

    Runs on model output as well as user input, so an unknown kind is dropped
    rather than passed to build_context and silently ignored there.
    """
    if not isinstance(kinds, list):
        return []
    wanted = {str(k).strip().lower() for k in kinds}
    return [k for k in sorted(CONTEXT_KINDS) if k in wanted]


# ---------------------------------------------------------------- folder CRUD


def create_folder(
    db: Session,
    repo_id: int,
    *,
    name: str,
    parent_id: int | None = None,
    source: str = "manual",
    template_key: str | None = None,
    rank: int | None = None,
) -> RepoDocFolder:
    clean = _clean_name(name)
    if parent_id is not None:
        get_folder_or_404(db, repo_id, parent_id)
    _assert_folder_name_free(db, repo_id, parent_id=parent_id, name=clean)
    row = RepoDocFolder(
        repo_id=repo_id,
        parent_id=parent_id,
        name=clean,
        rank=rank if rank is not None else (len(list_folders(db, repo_id)) + 1) * RANK_STEP,
        source=source,
        template_key=template_key,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_folder(
    db: Session,
    repo_id: int,
    folder_id: int,
    *,
    name: str | None = None,
    parent_id: int | None = None,
    reparent: bool = False,
) -> RepoDocFolder:
    """Rename and/or move a folder.

    ``reparent`` distinguishes "leave the parent alone" from "move to the root",
    which ``parent_id=None`` alone cannot express.
    """
    row = get_folder_or_404(db, repo_id, folder_id)
    target_parent = parent_id if reparent else row.parent_id

    if reparent and parent_id is not None:
        get_folder_or_404(db, repo_id, parent_id)
        # A folder can't be moved inside its own subtree: the rows would survive
        # but become unreachable from the root, invisible everywhere and
        # impossible to move back.
        if parent_id in descendant_ids(list_folders(db, repo_id), folder_id):
            raise DocError(409, "A folder can't be moved into itself.")

    clean = _clean_name(name) if name is not None else row.name
    _assert_folder_name_free(
        db, repo_id, parent_id=target_parent, name=clean, exclude_id=folder_id
    )

    row.name = clean
    row.parent_id = target_parent
    db.commit()
    db.refresh(row)
    return row


def delete_folder(db: Session, repo_id: int, folder_id: int) -> None:
    """Delete a folder and its subfolders. Documents survive at the set root.

    Both rules are the database's: parent_id CASCADEs onto subfolders,
    repo_docs.folder_id is SET NULL. Nothing is deleted from storage here, which
    is the entire point — see the note on the RepoDoc model.
    """
    row = db.get(RepoDocFolder, folder_id)
    if row is None or row.repo_id != repo_id:
        return
    db.delete(row)
    db.commit()


# ------------------------------------------------------------------- doc CRUD


def create_doc(
    db: Session,
    repo_id: int,
    *,
    title: str,
    folder_id: int | None = None,
    guidance: str | None = None,
    context_kinds: list[str] | None = None,
    markdown: str | None = None,
    source: str = "manual",
    template_key: str | None = None,
    rank: int | None = None,
) -> RepoDoc:
    clean = _clean_title(title)
    if folder_id is not None:
        get_folder_or_404(db, repo_id, folder_id)
    _assert_title_free(db, repo_id, folder_id=folder_id, title=clean)

    row = RepoDoc(
        repo_id=repo_id,
        folder_id=folder_id,
        title=clean,
        rank=rank if rank is not None else next_rank(db, repo_id),
        source=source,
        template_key=template_key,
        guidance=(guidance or "").strip() or None,
        context_kinds=clean_context_kinds(context_kinds or []),
        reference_file_ids=[],
        status="none",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    if markdown:
        save_markdown(db, row, markdown)
    return row


def update_doc(
    db: Session,
    doc_id: int,
    *,
    title: str | None = None,
    folder_id: int | None = None,
    refile: bool = False,
    guidance: str | None = None,
    instructions: str | None = None,
    reference_file_ids: list[int] | None = None,
) -> RepoDoc:
    """Rename, re-file, or re-brief a document.

    ``refile`` is the doc-side twin of update_folder's ``reparent``: without it,
    ``folder_id=None`` could not distinguish "move to the set root" from "leave
    it where it is".
    """
    row = get_doc_or_404(db, doc_id)
    target_folder = folder_id if refile else row.folder_id

    if refile and folder_id is not None:
        get_folder_or_404(db, row.repo_id, folder_id)

    clean = _clean_title(title) if title is not None else row.title
    _assert_title_free(
        db, row.repo_id, folder_id=target_folder, title=clean, exclude_id=row.id
    )

    row.title = clean
    row.folder_id = target_folder
    if guidance is not None:
        row.guidance = guidance.strip() or None
    if instructions is not None:
        row.instructions = instructions.strip() or None
    if reference_file_ids is not None:
        row.reference_file_ids = list(reference_file_ids)
    db.commit()
    db.refresh(row)
    return row


def delete_doc(db: Session, doc_id: int) -> None:
    """Tolerant delete: the row first, then the blob best-effort.

    Same order as delete_reference. An orphan blob is not worth a 500, and a
    surviving row pointing at nothing would be worse than an unreferenced
    object nobody can list.
    """
    row = db.get(RepoDoc, doc_id)
    if row is None:
        return
    key = row.storage_key
    db.delete(row)
    db.commit()
    if key:
        try:
            rustfs.delete_object(key)
        except Exception as exc:  # noqa: BLE001 - an orphan blob is not worth a 500
            log.warning("could not delete repo doc blob %s: %s", key, exc)


def purge_repo_docs(db: Session, repo_id: int) -> None:
    """Drop every blob in a repo's set, before the rows CASCADE away.

    rustfs has no list-objects, so these rows are the only index into the
    bucket: deleting the repo without this leaves every document's bytes
    unreachable forever. Best-effort per key — a storage hiccup must not block
    removing the repository.
    """
    keys = list(
        db.execute(
            select(RepoDoc.storage_key).where(
                RepoDoc.repo_id == repo_id, RepoDoc.storage_key.is_not(None)
            )
        )
        .scalars()
        .all()
    )
    for key in keys:
        try:
            rustfs.delete_object(key)
        except Exception as exc:  # noqa: BLE001 - see delete_doc
            log.warning("could not purge repo doc blob %s: %s", key, exc)


# --------------------------------------------------------------------- storage


def read_markdown(db: Session, doc: RepoDoc) -> str:
    """The document's markdown, or "" when it has never been written.

    A storage read failure is reported as an empty document plus a log line
    rather than an exception: the row, its status and its history are still
    worth serving, and the UI's "not generated yet" state is a truer thing to
    show than a 500 on a page that lists twelve other documents.
    """
    if not doc.storage_key:
        return ""
    try:
        return rustfs.get_object(doc.storage_key).decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001 - key wrong or storage down
        log.warning("could not read repo doc blob %s: %s", doc.storage_key, exc)
        return ""


def save_markdown(
    db: Session,
    doc: RepoDoc,
    markdown: str,
    *,
    model: str | None = None,
    summary: str | None = None,
    generated: bool = False,
) -> RepoDoc:
    """Write a document's markdown and mark it ready.

    Storage happens before the commit, as in store_reference: a storage failure
    must not leave a row claiming 'ready' with nothing behind it. The key is
    computed only on the first write — see the module docstring for why a rename
    deliberately does not move the object.

    ``generated`` picks which clock is stamped. That distinction is what lets
    the API derive `hand_edited` and warn before a regenerate discards someone's
    edits, so it is not cosmetic.
    """
    text = (markdown or "")[: settings.repo_doc_max_chars]
    data = text.encode("utf-8")

    rustfs.ensure_bucket()
    key = doc.storage_key or (
        f"repo-docs/{doc.repo_id}/{doc.id}/{refs.safe_filename(doc.title)}.md"
    )
    doc.storage_key = rustfs.put_object(key, data, _CONTENT_TYPE)

    doc.size_bytes = len(data)
    doc.char_count = len(text)
    doc.rev = (doc.rev or 0) + 1
    doc.status = "ready"
    doc.error = None
    if generated:
        doc.generated_at = _now()
        doc.model = model
        doc.summary = (summary or "").strip() or None
    else:
        doc.edited_at = _now()
    db.commit()
    db.refresh(doc)
    return doc


# --------------------------------------------------------------------- archive


def build_archive(db: Session, repo_id: int) -> tuple[str, bytes]:
    """The whole set as a .zip, laid out like the folder tree.

    The layout comes from folder *names*, never from storage keys, so the
    archive is correct after any rename. Arcnames are de-duplicated because
    safe_filename collapses distinct characters, so two different titles can map
    to one filename — zipfile writes duplicate entries happily and extractors
    then silently overwrite one with the other.

    A README manifest goes in at the top so a set that has not been generated
    yet still produces a meaningful archive rather than a zero-entry file some
    tools reject.
    """
    repo = get_repo_or_404(db, repo_id)
    folders = {f.id: f for f in list_folders(db, repo_id)}
    docs = list_docs(db, repo_id)

    buf = io.BytesIO()
    used: set[str] = set()
    manifest: list[str] = [
        f"# {repo.name} — documentation set",
        "",
        f"{len(docs)} document(s). Generated by Eaglyssier.",
        "",
        "| Document | Folder | Status | Generated |",
        "| --- | --- | --- | --- |",
    ]

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc in docs:
            path = folder_path(folders, doc.folder_id)
            where = "/".join(f.name for f in path) or "(root)"
            stamp = doc.generated_at.date().isoformat() if doc.generated_at else "—"
            state = doc.status if doc.storage_key else "not generated"

            if doc.storage_key:
                arcname = "/".join(
                    [
                        *(refs.safe_filename(f.name) for f in path),
                        f"{refs.safe_filename(doc.title)}.md",
                    ]
                )
                if arcname in used:
                    stem, _, ext = arcname.rpartition(".")
                    arcname = f"{stem}-{doc.id}.{ext}"
                used.add(arcname)
                try:
                    zf.writestr(arcname, rustfs.get_object(doc.storage_key))
                except Exception as exc:  # noqa: BLE001 - one bad blob must not kill the archive
                    log.warning("skipping repo doc %s in archive: %s", doc.id, exc)
                    state = "unreadable"

            manifest.append(f"| {doc.title} | {where} | {state} | {stamp} |")

        zf.writestr("README.md", "\n".join(manifest) + "\n")

    return f"{refs.safe_filename(repo.name)}-docs.zip", buf.getvalue()
