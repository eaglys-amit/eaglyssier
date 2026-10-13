"""Sync spec-kit feature folders from a repository into tracked specs.

For a repo with spec sync enabled, every folder under `spec_path` (default
"specs/") that has a spec.md becomes one Spec (source="repo"). On each sync:

- spec.md is re-parsed only when its text changed, through the same version
  comparison as uploaded documents (app.services.specs.apply_version), so
  changed requirements flag their linked tasks for review. The rule-based
  spec-kit parser runs first; free-form files fall back to the LLM.
- tasks.md lines are matched to existing tracker tasks — match only, nothing is
  created — and every matched task is linked to the requirements its line names
  ([US1] story tags, FR-001 mentions). These "repo" links are re-derived each
  sync; links people made by hand are never touched.
- Commits in the repo that aren't linked to a task yet, and whose message
  mentions a task id (T012) or requirement key (FR-003) that resolves to
  exactly one task, are linked to it.

Repo specs are read-only in the app: the repository is the source of truth.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import PurePosixPath

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.connectors.base import GitConnector
from app.connectors.dto import RepoDTO
from app.connectors.registry import build_connector
from app.models import Commit, GitRepo, Integration, Requirement, RequirementTask, Spec, Task
from app.services import speckit
from app.services import specs as specs_svc

log = logging.getLogger(__name__)

MAX_FEATURES = 200
PARSER_MODEL = "spec-kit parser"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_spec_path(path: str | None) -> str:
    path = (path or "").strip().strip("/")
    if not path or ".." in path.split("/"):
        return "specs/"
    return path + "/"


def claim(db: Session, repo: GitRepo) -> bool:
    claimed = db.execute(
        update(GitRepo)
        .where(GitRepo.id == repo.id, GitRepo.spec_sync_status != "running")
        .values(spec_sync_status="running", spec_sync_error=None)
    )
    db.commit()
    db.refresh(repo)
    return claimed.rowcount > 0


def _connector(db: Session, repo: GitRepo) -> tuple[GitConnector, RepoDTO]:
    integration = db.execute(
        select(Integration).where(
            Integration.project_id == repo.project_id,
            Integration.type == repo.provider,
            Integration.enabled.is_(True),
        )
    ).scalars().first()
    if integration is None:
        raise RuntimeError(f"No enabled {repo.provider.value} integration for this project.")
    connector = build_connector(integration)
    if not isinstance(connector, GitConnector):
        raise RuntimeError(f"{repo.provider.value} connector cannot read repositories.")
    return connector, RepoDTO(external_id=repo.external_id, name=repo.name, url=repo.url)


def feature_folders(paths: list[str], prefix: str) -> list[str]:
    """Folders directly under `prefix` that contain a spec.md, e.g. "specs/001-albums"."""
    prefix = prefix.strip("/")
    found = set()
    for p in paths:
        parts = PurePosixPath(p).parts
        base = PurePosixPath(prefix).parts
        if len(parts) == len(base) + 2 and parts[: len(base)] == base and parts[-1] == "spec.md":
            found.add("/".join(parts[:-1]))
    return sorted(found)[:MAX_FEATURES]


def _candidates(db: Session, project_id: int) -> list[speckit.Candidate]:
    rows = db.execute(select(Task).where(Task.project_id == project_id)).scalars().all()
    # The tracker key goes into the matched text so "PAY-12 T012 …" style
    # titles and keys both count.
    return [
        speckit.Candidate(task_id=t.id, title=f"{t.external_key or ''} {t.title or ''}".strip())
        for t in rows
    ]


def _sync_repo_links(db: Session, spec: Spec, repo_tasks: list[dict]) -> None:
    """Replace this spec's repo-origin links with what tasks.md now says."""
    reqs = {r.key: r for r in spec.requirements if r.change_state != "removed"}
    wanted: set[tuple[int, int]] = set()
    for rt in repo_tasks:
        if rt["task_id"] is None:
            continue
        for key in [*rt["requirement_keys"], *([rt["story"]] if rt["story"] else [])]:
            if (req := reqs.get(key)) is not None:
                wanted.add((req.id, rt["task_id"]))

    req_ids = [r.id for r in spec.requirements]
    existing = {
        (link.requirement_id, link.task_id): link
        for link in db.execute(
            select(RequirementTask).where(RequirementTask.requirement_id.in_(req_ids or [-1]))
        ).scalars()
    }
    for pair, link in existing.items():
        if link.origin == "repo" and pair not in wanted:
            db.delete(link)
    for req_id, task_id in wanted - existing.keys():
        db.add(RequirementTask(requirement_id=req_id, task_id=task_id, origin="repo"))


def _sync_feature(
    db: Session,
    repo: GitRepo,
    connector: GitConnector,
    dto: RepoDTO,
    *,
    folder: str,
    files: set[str],
    branch: str,
    spec: Spec | None,
    candidates: list[speckit.Candidate],
) -> Spec:
    def read(name: str) -> str | None:
        path = f"{folder}/{name}"
        return connector.read_file(dto, path, branch) if path in files else None

    spec_md = read("spec.md") or ""
    if spec is None:
        spec = Spec(project_id=repo.project_id, source="repo", repo_id=repo.id, path=folder,
                    title=folder.rsplit("/", 1)[-1], status="approved")
        db.add(spec)
        db.flush()
    spec.title = speckit.spec_title(spec_md, folder.rsplit("/", 1)[-1])
    spec.ref = branch
    spec.missing_in_repo = False

    if spec_md.strip() and specs_svc.text_hash(spec_md) != spec.content_hash:
        parsed = speckit.parse_spec_md(spec_md)
        model = PARSER_MODEL
        if not parsed:
            parsed, model = specs_svc.extract_with_llm(repo.project, spec_md)
        specs_svc.apply_version(db, spec, parsed, text=spec_md, file_id=None)
        spec.extract_model = model
        db.flush()
        db.refresh(spec)

    spec.plan_markdown = read("plan.md")
    tasks_md = read("tasks.md")
    parsed_tasks = speckit.parse_tasks_md(tasks_md) if tasks_md else []
    matches = speckit.match_tasks(parsed_tasks, candidates)
    spec.repo_tasks = [
        {
            "key": t.key, "text": t.text, "done": t.done, "story": t.story,
            "parallel": t.parallel, "requirement_keys": t.requirement_keys,
            "task_id": matches[t.key][0] if t.key in matches else None,
            "match": matches[t.key][1] if t.key in matches else None,
        }
        for t in parsed_tasks
    ]
    _sync_repo_links(db, spec, spec.repo_tasks)
    spec.extract_status = "ready"
    spec.extract_error = None
    spec.synced_at = _now()
    return spec


def link_commits_from_messages(db: Session, repo: GitRepo, specs: list[Spec]) -> int:
    """Link unlinked commits whose message names exactly one task. Returns how many."""
    by_task_key: dict[str, set[tuple[int, str]]] = {}
    for spec in specs:
        for rt in spec.repo_tasks or []:
            if rt.get("task_id"):
                by_task_key.setdefault(rt["key"], set()).add((rt["task_id"], spec.path or ""))
    # Queried rather than read off req.task_links: links added earlier in this
    # same sync aren't in those (already loaded) collections yet. A key that
    # appears in several features unions their tasks, which then reads as
    # ambiguous below — the safe outcome.
    by_req_key: dict[str, set[int]] = {}
    rows = db.execute(
        select(Requirement.key, RequirementTask.task_id)
        .join(RequirementTask, RequirementTask.requirement_id == Requirement.id)
        .where(Requirement.spec_id.in_([s.id for s in specs] or [-1]),
               Requirement.change_state != "removed")
    ).all()
    for key, task_id in rows:
        by_req_key.setdefault(key, set()).add(task_id)
    if not (by_task_key or by_req_key):
        return 0

    linked = 0
    commits = db.execute(
        select(Commit).where(
            Commit.repo_id == repo.id,
            Commit.linked_task_id.is_(None),
            Commit.link_status.in_(("none", "ready", "failed")),
        )
    ).scalars().all()
    for c in commits:
        task_id, reason = None, None
        for key in sorted(speckit.mentioned_task_keys(c.message or "")):
            hits = by_task_key.get(key, set())
            if len({t for t, _ in hits}) == 1:  # T-ids repeat per feature: must be unambiguous
                (task_id, folder), = hits
                reason = f"Message mentions {key} ({folder}/tasks.md)"
                break
        if task_id is None:
            for key in sorted(speckit.mentioned_requirement_keys(c.message or "")):
                tasks = by_req_key.get(key, set())
                if len(tasks) == 1:
                    (task_id,) = tasks
                    reason = f"Message mentions {key}, implemented by this task"
                    break
        if task_id is not None:
            c.linked_task_id = task_id
            c.link_status = "ready"
            c.link_reason = reason
            c.link_error = None
            linked += 1
    return linked


def sync_repo_specs(db: Session, repo_id: int) -> None:
    """Background job: read the repo's spec folders and apply them. Never raises."""
    repo = db.get(GitRepo, repo_id)
    if repo is None:
        return
    try:
        connector, dto = _connector(db, repo)
        branch = connector.default_branch(dto)
        repo.default_branch = branch
        prefix = normalize_spec_path(repo.spec_path)
        paths = connector.list_files(dto, prefix, branch)
        files = set(paths)
        folders = feature_folders(paths, prefix)

        existing = {
            s.path: s for s in db.execute(
                select(Spec).where(Spec.repo_id == repo.id)
                .options(selectinload(Spec.requirements).selectinload(Requirement.task_links))
            ).scalars()
        }
        candidates = _candidates(db, repo.project_id)
        synced: list[Spec] = []
        for folder in folders:
            synced.append(_sync_feature(
                db, repo, connector, dto, folder=folder, files=files, branch=branch,
                spec=existing.get(folder), candidates=candidates,
            ))
        for path, spec in existing.items():
            if path not in folders:
                spec.missing_in_repo = True
        db.flush()
        for spec in synced:
            db.refresh(spec)
        n_commits = link_commits_from_messages(db, repo, synced)

        repo.spec_sync_status = "ready"
        repo.spec_sync_error = (
            None if folders else f"No spec folders (with a spec.md) found under {prefix} on {branch}."
        )
        repo.spec_synced_at = _now()
        db.commit()
        log.info("Repo %s specs: %d feature(s), %d commit(s) linked", repo_id, len(folders), n_commits)
    except Exception as exc:  # noqa: BLE001 - failures land on the row
        db.rollback()
        log.warning("Spec sync failed for repo %s: %s", repo_id, exc)
        repo = db.get(GitRepo, repo_id)
        if repo is not None:
            repo.spec_sync_status = "failed"
            repo.spec_sync_error = str(exc)[:1000] or exc.__class__.__name__
            repo.spec_synced_at = _now()
            db.commit()


def sync_enabled_repos(db: Session, project_id: int, provider) -> None:
    """After a git sync: refresh specs for every repo that opted in. Never raises."""
    repo_ids = db.execute(
        select(GitRepo.id).where(
            GitRepo.project_id == project_id,
            GitRepo.provider == provider,
            GitRepo.spec_sync_enabled.is_(True),
        )
    ).scalars().all()
    for rid in repo_ids:
        repo = db.get(GitRepo, rid)
        if repo is not None and claim(db, repo):
            sync_repo_specs(db, rid)

