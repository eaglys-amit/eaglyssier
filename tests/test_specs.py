"""Specs: version comparison, parsing, extraction flow, status, coverage, rights."""
from __future__ import annotations

import pytest

from app.api.routes import specs as specs_routes
from app.models import ReferenceFile, Spec, StatusCategory, Task
from app.services import analyzers, spec_diff, specs
from app.services import references as refs_svc
from app.services.analyzers import AnalyzerError, AnalyzerResult

P = spec_diff.Parsed


def _ex(id, key, excerpt, origin="document", state="unchanged", criteria=()):
    return spec_diff.Existing(id=id, key=key, key_origin=origin, statement=excerpt,
                              source_excerpt=excerpt, acceptance_criteria=list(criteria),
                              change_state=state)


# ------------------------------------------------------------------- diffing

def test_document_keys_match_and_paraphrase_is_not_a_change():
    old = [_ex(1, "FR-001", "Users can reset their password by email."),
           _ex(2, "FR-002", "Sessions expire after 30 minutes of inactivity.")]
    new = [
        # Same verbatim excerpt, reworded statement: unchanged.
        P("FR-001", True, "Password reset", "The system must allow email password resets.",
          source_excerpt="Users can reset their password by email."),
        P("FR-002", True, "Session timeout", "Sessions expire after 15 minutes.",
          source_excerpt="Sessions expire after 15 minutes of inactivity."),
        P("FR-003", True, "Audit log", "All logins are logged.",
          source_excerpt="All logins are written to the audit log."),
    ]
    plan = spec_diff.plan_version(old, new)
    changed = {m.key: m.changed for m in plan.matches}
    assert changed == {"FR-001": False, "FR-002": True}
    assert [k for k, _ in plan.added] == ["FR-003"]
    assert plan.removed == []


def test_generated_keys_match_by_text_and_keep_their_key():
    old = [_ex(1, "R-1", "Export the monthly report as PDF.", origin="generated"),
           _ex(2, "R-2", "Admins can invite users by email.", origin="generated")]
    new = [P(None, False, "Invite", "x", source_excerpt="Admins can invite new users by email."),
           P(None, False, "Dark mode", "x", source_excerpt="Support a dark colour theme.")]
    plan = spec_diff.plan_version(old, new)
    assert [(m.existing_id, m.key) for m in plan.matches] == [(2, "R-2")]
    assert [k for k, _ in plan.added] == ["R-3"]  # numbering continues after R-2
    assert plan.removed == [1]


def test_manual_requirements_are_left_alone_and_removed_ones_can_return():
    old = [_ex(1, "FR-001", "A", state="removed"), _ex(2, "M-1", "manual one", origin="manual")]
    plan = spec_diff.plan_version(old, [P("FR-001", True, "A", "A", source_excerpt="A")])
    assert [m.existing_id for m in plan.matches] == [1]
    assert plan.removed == []  # the manual one is never "removed" by a new version


def test_acceptance_criteria_change_counts_as_changed():
    old = [_ex(1, "FR-1", "Login works.", criteria=["Valid password logs in"])]
    new = [P("FR-1", True, "Login", "Login works.", source_excerpt="Login works.",
             acceptance_criteria=["Valid password logs in", "Lockout after 5 failures"])]
    assert spec_diff.plan_version(old, new).matches[0].changed is True


def test_parse_requirements_validates():
    parsed = specs.parse_requirements({"requirements": [
        {"key": "fr-001", "title": "A", "statement": "S", "kind": "weird", "priority": "P0",
         "acceptance_criteria": ["ok", ""], "source_excerpt": "src"},
        {"key": "FR-001", "title": "Dup key", "statement": "S2"},
        "junk", {"title": "", "statement": ""},
    ]})
    assert [(p.key, p.key_from_document) for p in parsed] == [("FR-001", True), (None, False)]
    assert parsed[0].kind == "functional" and parsed[0].priority is None
    assert parsed[0].acceptance_criteria == ["ok"]
    with pytest.raises(AnalyzerError):
        specs.parse_requirements({"nope": []})


# --------------------------------------------------------------- API flow

V1 = {"requirements": [
    {"key": "FR-001", "title": "Reset password", "statement": "Users can reset passwords.",
     "kind": "functional", "priority": "must", "acceptance_criteria": ["Email link works"],
     "source_excerpt": "Users can reset their password by email."},
    {"key": "FR-002", "title": "Timeout", "statement": "Sessions time out.",
     "source_excerpt": "Sessions expire after 30 minutes of inactivity."},
]}
V2 = {"requirements": [
    {"key": "FR-001", "title": "Reset password", "statement": "Reworded.",
     "acceptance_criteria": ["Email link works"],
     "source_excerpt": "Users can reset their password by email."},
    {"key": "FR-002", "title": "Timeout", "statement": "Sessions time out sooner.",
     "source_excerpt": "Sessions expire after 10 minutes of inactivity."},
]}


class _Fake:
    def __init__(self, data):
        self.data = data

    def analyze(self, prompt):
        assert "Specification:" in prompt
        return AnalyzerResult(data=self.data, model="fake")


@pytest.fixture
def run_inline(db, monkeypatch):
    """Run background extraction on the test session, and skip object storage."""
    monkeypatch.setattr(specs_routes, "run_in_session", lambda fn, *a: fn(db, *a))
    monkeypatch.setattr(refs_svc.rustfs, "put_object", lambda key, *a, **k: key)
    monkeypatch.setattr(refs_svc.rustfs, "ensure_bucket", lambda *a, **k: None)

    def use(data):
        monkeypatch.setattr(analyzers, "get_analyzer", lambda *a, **k: _Fake(data))
    return use


def _doc(db, pid, text="Users can reset their password by email. Sessions expire after 30."):
    f = ReferenceFile(project_id=pid, filename="auth-spec.md", content_type="text/markdown",
                      kind="md", storage_key="k", extracted_text=text, char_count=len(text),
                      extract_status="ready")
    db.add(f)
    db.commit()
    return f.id


def test_spec_lifecycle(as_role, world, db, run_inline):
    pid = world["project"]
    pm = as_role("project_manager")
    run_inline(V1)

    r = pm.post(f"/api/projects/{pid}/specs", json={"reference_file_id": _doc(db, pid)})
    assert r.status_code == 202, r.text
    sid = r.json()["id"]
    spec = pm.get(f"/api/specs/{sid}").json()
    assert spec["title"] == "auth-spec" and spec["version"] == 1
    assert spec["extract_status"] == "ready"
    assert [q["key"] for q in spec["requirements"]] == ["FR-001", "FR-002"]
    assert all(q["change_state"] == "unchanged" for q in spec["requirements"])
    assert spec["coverage"] == {"total": 2, "linked": 0, "implemented": 0, "verified": 0,
                                "changed": 0, "needs_review": 0}

    # Link a done task to FR-001 and an open one to FR-002.
    done = Task(project_id=pid, title="Reset flow", source="local", status="Done",
                status_category=StatusCategory.done)
    todo = Task(project_id=pid, title="Timeout", source="local", status="To Do",
                status_category=StatusCategory.todo)
    db.add_all([done, todo])
    db.commit()
    fr1, fr2 = (q["id"] for q in spec["requirements"])
    dev = as_role("developer")
    assert dev.post(f"/api/requirements/{fr1}/tasks", json={"task_id": done.id}).status_code == 204
    assert dev.post(f"/api/requirements/{fr2}/tasks", json={"task_id": todo.id}).status_code == 204
    spec = pm.get(f"/api/specs/{sid}").json()
    assert [q["status"] for q in spec["requirements"]] == ["implemented", "planned"]
    assert spec["coverage"]["linked"] == 2 and spec["coverage"]["implemented"] == 1
    assert dev.get(f"/api/tasks/{todo.id}/requirements").json()[0]["key"] == "FR-002"

    # Version 2: FR-002's wording changed in the document.
    run_inline(V2)
    r = pm.post(f"/api/specs/{sid}/versions",
                files={"file": ("auth-spec-v2.md", b"Sessions expire after 10.", "text/markdown")})
    assert r.status_code == 202, r.text
    spec = pm.get(f"/api/specs/{sid}").json()
    assert spec["version"] == 2 and spec["filename"] == "auth-spec-v2.md"
    states = {q["key"]: q["change_state"] for q in spec["requirements"]}
    assert states == {"FR-001": "unchanged", "FR-002": "changed"}
    fr2_out = next(q for q in spec["requirements"] if q["key"] == "FR-002")
    assert fr2_out["tasks"][0]["needs_review"] is True
    assert spec["coverage"]["needs_review"] == 1 and spec["coverage"]["changed"] == 1
    assert spec["revisions"][0] == {**spec["revisions"][0], "version": 2,
                                    "changes": {"added": 0, "changed": 1, "removed": 0}}

    assert dev.post(f"/api/requirements/{fr2}/tasks/{todo.id}/reviewed").status_code == 204
    assert pm.get(f"/api/specs/{sid}").json()["coverage"]["needs_review"] == 0


def test_spec_rights_and_repo_specs_are_read_only(as_role, world, db, run_inline):
    pid = world["project"]
    run_inline(V1)
    file_id = _doc(db, pid)
    assert as_role("developer").post(f"/api/projects/{pid}/specs",
                                     json={"reference_file_id": file_id}).status_code == 403
    r = as_role("vp_product").post(f"/api/projects/{pid}/specs", json={"reference_file_id": file_id})
    assert r.status_code == 202
    req_id = r.json()["requirements"][0]["id"] if r.json()["requirements"] else None
    sid = r.json()["id"]
    req_id = as_role("vp_product").get(f"/api/specs/{sid}").json()["requirements"][0]["id"]
    # Linking work is task work: a VP can shape specs but not link tasks.
    task = Task(project_id=pid, title="t", source="local", status="To Do",
                status_category=StatusCategory.todo)
    db.add(task)
    db.commit()
    assert as_role("vp_product").post(f"/api/requirements/{req_id}/tasks",
                                      json={"task_id": task.id}).status_code == 403
    # Cross-project task ids are refused.
    other = Task(project_id=world["other_project"], title="x", source="local",
                 status="To Do", status_category=StatusCategory.todo)
    db.add(other)
    db.commit()
    assert as_role("admin").post(f"/api/requirements/{req_id}/tasks",
                                 json={"task_id": other.id}).status_code == 404

    repo_spec = Spec(project_id=pid, title="From repo", source="repo")
    db.add(repo_spec)
    db.commit()
    r = as_role("project_manager").post(f"/api/specs/{repo_spec.id}/requirements",
                                        json={"title": "Nope"})
    assert r.status_code == 409


def test_failed_extraction_is_recorded(as_role, world, db, run_inline, monkeypatch):
    pid = world["project"]

    class _Broken:
        def analyze(self, prompt):
            raise AnalyzerError("not logged in")
    monkeypatch.setattr(specs_routes, "run_in_session", lambda fn, *a: fn(db, *a))
    monkeypatch.setattr(analyzers, "get_analyzer", lambda *a, **k: _Broken())
    r = as_role("project_manager").post(f"/api/projects/{pid}/specs",
                                        json={"reference_file_id": _doc(db, pid)})
    spec = as_role("project_manager").get(f"/api/specs/{r.json()['id']}").json()
    assert spec["extract_status"] == "failed" and "not logged in" in spec["extract_error"]
    assert spec["version"] == 0 and spec["requirements"] == []


def test_small_meaningful_edits_count_as_changed():
    old = [_ex(1, "FR-1", "Sessions expire after 30 minutes."),
           _ex(2, "FR-2", "Admins must approve refunds.")]
    new = [P("FR-1", True, "t", "s", source_excerpt="Sessions expire after 10 minutes."),
           P("FR-2", True, "t", "s", source_excerpt="Admins must not approve refunds.")]
    assert all(m.changed for m in spec_diff.plan_version(old, new).matches)


def test_quoting_more_of_the_same_passage_is_not_a_change():
    old = [_ex(1, "FR-1", "Sessions expire after 30 minutes.")]
    new = [P("FR-1", True, "t", "s",
             source_excerpt="Security: sessions expire after 30 minutes, per policy.")]
    assert spec_diff.plan_version(old, new).matches[0].changed is False
