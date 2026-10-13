"""Repository specs: spec-kit parsing, task matching, sync, commit linking, API."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.api.routes import specs as specs_routes
from app.models import (
    Commit,
    GitRepo,
    IntegrationType,
    RequirementTask,
    Spec,
    StatusCategory,
    Task,
)
from app.services import repo_specs, speckit

FIXTURE = Path(__file__).parent / "fixtures" / "speckit"
FEATURE = "specs/001-photo-albums"


def _read(name: str) -> str:
    return (FIXTURE / "001-photo-albums" / name).read_text()


# ------------------------------------------------------------------- parsing

def test_parse_spec_md():
    text = _read("spec.md")
    assert speckit.spec_title(text, "x") == "Photo Albums"
    assert speckit.spec_title("# Feature Specification: [FEATURE NAME]", "001-x") == "001-x"
    parsed = {p.key: p for p in speckit.parse_spec_md(text)}
    assert list(parsed) == ["US1", "US2", "FR-001", "FR-002", "FR-003", "FR-004", "SC-001"]
    us1 = parsed["US1"]
    assert (us1.kind, us1.priority, us1.title) == ("user_story", "must", "Organise photos into albums")
    assert us1.statement.startswith("A user groups their photos")
    assert len(us1.acceptance_criteria) == 2 and us1.acceptance_criteria[0].startswith("Given photos")
    assert parsed["US2"].priority == "should"
    assert parsed["FR-003"].priority == "should" and parsed["SC-001"].kind == "non_functional"
    assert speckit.parse_spec_md("Just prose, no keyed requirements.") == []


def test_parse_tasks_md():
    tasks = {t.key: t for t in speckit.parse_tasks_md(_read("tasks.md"))}
    assert tasks["T001"].done and not tasks["T002"].done and tasks["T002"].parallel
    assert tasks["T010"].story == "US1" and tasks["T010"].text == "Create Album model in src/models/album.py"
    # Untagged, but under "Phase 3: User Story 1": the story comes from the heading.
    assert tasks["T012"].story == "US1" and tasks["T012"].requirement_keys == ["FR-002"]
    assert tasks["T020"].story == "US2" and tasks["T001"].story is None


def test_match_tasks():
    repo_tasks = speckit.parse_tasks_md(_read("tasks.md"))
    cands = [
        speckit.Candidate(1, "PHO-7 T010 Create Album model"),          # id + words
        speckit.Candidate(2, "T011 Something unrelated entirely"),      # id, wrong words
        speckit.Candidate(3, "Implement share link endpoint in src/api/share.py"),  # words only
        speckit.Candidate(4, "Implement share link endpoint in src/api/share.py"),  # duplicate
    ]
    m = speckit.match_tasks(repo_tasks, cands)
    assert m["T010"] == (1, "key")
    assert "T011" not in m
    assert m["T020"][1] == "title" and m["T020"][0] in (3, 4)
    assert len({tid for tid, _ in m.values()}) == len(m)  # one tracker task per line


def test_feature_folders():
    paths = ["specs/001-a/spec.md", "specs/001-a/tasks.md", "specs/002-b/plan.md",
             "specs/003-c/spec.md", "specs/deep/x/spec.md", "docs/spec.md"]
    assert repo_specs.feature_folders(paths, "specs/") == ["specs/001-a", "specs/003-c"]
    assert repo_specs.normalize_spec_path("/../etc") == "specs/"
    assert repo_specs.normalize_spec_path("product/specs") == "product/specs/"


# ---------------------------------------------------------------------- sync

class FakeConnector:
    def __init__(self, files: dict[str, str]):
        self.files = files

    def default_branch(self, dto):
        return "main"

    def list_files(self, dto, prefix, ref):
        return sorted(p for p in self.files if p.startswith(prefix))

    def read_file(self, dto, path, ref):
        return self.files.get(path)


def _files(**overrides) -> dict[str, str]:
    files = {f"{FEATURE}/{n}": _read(n) for n in ("spec.md", "plan.md", "tasks.md")}
    files.update({f"{FEATURE}/{k.replace('_', '.')}": v for k, v in overrides.items()})
    return files


@pytest.fixture
def repo_world(db, world, monkeypatch):
    pid = world["project"]
    repo = GitRepo(project_id=pid, provider=IntegrationType.github, external_id="1",
                   name="acme/photos", url="https://github.com/acme/photos",
                   spec_sync_enabled=True)
    db.add(repo)
    db.flush()
    tasks = {
        "model": Task(project_id=pid, external_key="PHO-7", title="T010 Create Album model",
                      source="sync", status="Done", status_category=StatusCategory.done),
        "grouping": Task(project_id=pid, external_key="PHO-8",
                         title="Implement album grouping service in src/services/albums.py",
                         source="sync", status="In Progress",
                         status_category=StatusCategory.in_progress),
    }
    db.add_all(tasks.values())
    db.commit()
    connector = FakeConnector(_files())
    monkeypatch.setattr(repo_specs, "_connector", lambda db_, r: (connector, None))
    return {"repo": repo, "tasks": tasks, "connector": connector, "pid": pid}


def _spec(db) -> Spec:
    db.expire_all()
    return db.query(Spec).filter_by(path=FEATURE).one()


def test_sync_creates_spec_matches_tasks_and_links(db, repo_world):
    repo, tasks = repo_world["repo"], repo_world["tasks"]
    repo_specs.sync_repo_specs(db, repo.id)

    db.expire_all()
    assert repo.spec_sync_status == "ready" and repo.default_branch == "main"
    spec = _spec(db)
    assert (spec.source, spec.title, spec.status, spec.version) == ("repo", "Photo Albums", "approved", 1)
    assert spec.extract_model == repo_specs.PARSER_MODEL
    assert spec.plan_markdown.startswith("# Implementation Plan")
    by_key = {rt["key"]: rt for rt in spec.repo_tasks}
    assert by_key["T010"]["task_id"] == tasks["model"].id and by_key["T010"]["match"] == "key"
    assert by_key["T011"]["task_id"] == tasks["grouping"].id and by_key["T011"]["match"] == "title"
    assert by_key["T020"]["task_id"] is None  # match only: nothing created

    links = {(lk.requirement.key, lk.task_id, lk.origin) for lk in db.query(RequirementTask)}
    assert links == {
        ("US1", tasks["model"].id, "repo"),
        ("US1", tasks["grouping"].id, "repo"),
        ("FR-001", tasks["grouping"].id, "repo"),
    }


def test_resync_versions_and_rederives_repo_links_only(db, repo_world, as_role):
    repo, tasks, conn = repo_world["repo"], repo_world["tasks"], repo_world["connector"]
    repo_specs.sync_repo_specs(db, repo.id)
    spec = _spec(db)
    fr2 = next(r for r in spec.requirements if r.key == "FR-002")
    # Someone links FR-002 by hand; repo syncs must never remove that.
    db.add(RequirementTask(requirement_id=fr2.id, task_id=tasks["model"].id, origin="manual"))
    db.commit()

    # FR-001 is reworded, and T011 no longer cites it.
    conn.files = _files(
        spec_md=_read("spec.md").replace("by capture date", "by capture date and location"),
        tasks_md=_read("tasks.md").replace(" (FR-001)", ""),
    )
    repo_specs.sync_repo_specs(db, repo.id)
    spec = _spec(db)
    assert spec.version == 2
    states = {r.key: r.change_state for r in spec.requirements}
    assert states["FR-001"] == "changed" and states["FR-002"] == "unchanged"
    links = {(lk.requirement.key, lk.task_id, lk.origin) for lk in db.query(RequirementTask)}
    assert ("FR-001", tasks["grouping"].id, "repo") not in links
    assert ("FR-002", tasks["model"].id, "manual") in links

    # A third sync with nothing changed doesn't add a version.
    repo_specs.sync_repo_specs(db, repo.id)
    assert _spec(db).version == 2

    # A removed folder is kept and flagged, not deleted.
    conn.files = {}
    repo_specs.sync_repo_specs(db, repo.id)
    db.expire_all()
    assert _spec(db).missing_in_repo is True
    assert "No spec folders" in db.get(GitRepo, repo.id).spec_sync_error


def test_commits_link_by_task_id_or_requirement_key(db, repo_world):
    repo, tasks = repo_world["repo"], repo_world["tasks"]
    model, grouping = tasks["model"], tasks["grouping"]
    commits = {
        "tid": Commit(repo_id=repo.id, sha="a1", message="T011: group albums by date"),
        "req": Commit(repo_id=repo.id, sha="a2", message="Albums now group (FR-001)"),
        "ambiguous": Commit(repo_id=repo.id, sha="a3", message="US1 polish, see T999"),
        "already": Commit(repo_id=repo.id, sha="a4", message="T010 model",
                          linked_task_id=grouping.id, link_status="ready"),
    }
    db.add_all(commits.values())
    db.commit()
    repo_specs.sync_repo_specs(db, repo.id)
    db.expire_all()
    got = {k: db.get(Commit, c.id) for k, c in commits.items()}
    assert got["tid"].linked_task_id == grouping.id and "T011" in got["tid"].link_reason
    assert got["req"].linked_task_id == grouping.id and "FR-001" in got["req"].link_reason
    assert got["ambiguous"].linked_task_id is None
    assert got["already"].linked_task_id == grouping.id  # existing links are never overridden


def test_failed_sync_is_recorded(db, repo_world, monkeypatch):
    def boom(db_, r):
        raise RuntimeError("token expired")
    monkeypatch.setattr(repo_specs, "_connector", boom)
    repo_specs.sync_repo_specs(db, repo_world["repo"].id)
    db.expire_all()
    repo = db.get(GitRepo, repo_world["repo"].id)
    assert repo.spec_sync_status == "failed" and "token expired" in repo.spec_sync_error


# ----------------------------------------------------------------------- API

def test_spec_source_api(db, repo_world, as_role, monkeypatch):
    monkeypatch.setattr(specs_routes, "run_in_session", lambda fn, *a: fn(db, *a))
    pid, repo = repo_world["pid"], repo_world["repo"]
    url = f"/api/repos/{repo.id}/spec-source"
    assert as_role("developer").put(url, json={"enabled": True}).status_code == 403
    assert as_role("vp_product").put(url, json={"enabled": True}).status_code == 403

    r = as_role("tech_lead").put(url, json={"enabled": True, "spec_path": "/specs"})
    assert r.status_code == 200, r.text
    assert r.json()["spec_path"] == "specs/"

    sources = as_role("vp_product").get(f"/api/projects/{pid}/spec-sources").json()
    assert sources[0]["spec_count"] == 1 and sources[0]["spec_sync_status"] == "ready"

    spec = as_role("vp_product").get(f"/api/projects/{pid}/specs").json()[0]
    detail = as_role("vp_product").get(f"/api/specs/{spec['id']}").json()
    assert detail["repo_name"] == "acme/photos" and detail["path"] == FEATURE
    assert detail["repo_url"] == f"https://github.com/acme/photos/tree/main/{FEATURE}"
    t010 = next(t for t in detail["repo_tasks"] if t["key"] == "T010")
    assert t010["task_key"] == "PHO-7" and t010["task_status_category"] == "done"
    assert as_role("tech_lead").post(f"/api/specs/{spec['id']}/versions",
                                     files={"file": ("x.md", b"x", "text/markdown")}).status_code == 409

    assert as_role("tech_lead").post(f"/api/repos/{repo.id}/specs/sync").status_code == 202
    off = as_role("tech_lead").put(url, json={"enabled": False})
    assert off.json()["spec_sync_enabled"] is False and off.json()["spec_count"] == 1
    assert as_role("tech_lead").post(f"/api/repos/{repo.id}/specs/sync").status_code == 409
