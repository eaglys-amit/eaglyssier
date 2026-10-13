"""Verification, AI checks, untraced work, and coverage in Portfolio/Executive report."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.api.routes import specs as specs_routes
from app.models import (
    Commit,
    GitRepo,
    IntegrationType,
    Requirement,
    RequirementTask,
    Spec,
    Sprint,
    StatusCategory,
    Task,
)
from app.reporting.charts import build_charts
from app.services import analyzers, exec_report, spec_diff, spec_verify, specs
from app.services.analyzers import AnalyzerError, AnalyzerResult
from app.services.portfolio import project_health
from app.templating import render

DONE, TODO = StatusCategory.done, StatusCategory.todo


@pytest.fixture
def setup(db, world):
    """An approved spec with FR-1 (two criteria, linked to a done task) and FR-2 (must, untraced)."""
    pid = world["project"]
    spec = Spec(project_id=pid, title="Auth", source="document", status="approved", version=1)
    db.add(spec)
    db.flush()
    crit = [{"text": t, "verified": False, "verified_by": None, "verified_at": None}
            for t in ("Lockout after 5 failures", "Unlock email is sent")]
    fr1 = Requirement(spec_id=spec.id, key="FR-1", key_origin="document", title="Lockout",
                      statement="Lock accounts after repeated failures.", priority="must",
                      acceptance_criteria=crit, rank=0, source_excerpt="Lock accounts.")
    fr2 = Requirement(spec_id=spec.id, key="FR-2", key_origin="document", title="Audit log",
                      statement="Log every login.", priority="must", acceptance_criteria=[], rank=1)
    db.add_all([fr1, fr2])
    task = Task(project_id=pid, external_key="AUTH-3", title="Account lockout", source="sync",
                status="Done", status_category=DONE, acceptance_criteria="5 attempts")
    db.add(task)
    db.flush()
    db.add(RequirementTask(requirement_id=fr1.id, task_id=task.id))
    repo = GitRepo(project_id=pid, provider=IntegrationType.github, external_id="1", name="a/b")
    db.add(repo)
    db.flush()
    db.add(Commit(repo_id=repo.id, sha="abcdef1234", message="lockout", linked_task_id=task.id,
                  analysis={"summary": "Adds lockout after 5 failed logins",
                            "changes": ["counter in auth service"]}))
    db.commit()
    return {"pid": pid, "spec": spec, "fr1": fr1, "fr2": fr2, "task": task}


def _detail(as_role, spec_id):
    return {r["key"]: r for r in as_role("vp_product").get(f"/api/specs/{spec_id}").json()["requirements"]}


# ------------------------------------------------------------ manual ticks

def test_ticking_all_criteria_verifies(as_role, setup):
    fr1, sid = setup["fr1"], setup["spec"].id
    url = f"/api/requirements/{fr1.id}/criteria"
    body0 = {"text": "Lockout after 5 failures", "verified": True}
    assert as_role("developer").put(f"{url}/0", json=body0).status_code == 403
    assert as_role("vp_product").put(f"{url}/0", json=body0).status_code == 403
    assert as_role("tech_lead").put(f"{url}/0", json=body0).status_code == 204
    assert as_role("tech_lead").put(f"{url}/1", json={"text": "edited meanwhile", "verified": True}).status_code == 409
    assert _detail(as_role, sid)["FR-1"]["status"] == "implemented"

    assert as_role("project_manager").put(
        f"{url}/1", json={"text": "Unlock email is sent", "verified": True}).status_code == 204
    fr = _detail(as_role, sid)["FR-1"]
    assert fr["status"] == "verified"
    assert fr["acceptance_criteria"][0]["verified_by"] == "Tech_Lead"
    cov = as_role("vp_product").get(f"/api/specs/{sid}").json()["coverage"]
    assert cov["verified"] == 1 and cov["implemented"] == 1 and cov["linked"] == 1


# ---------------------------------------------------------------- AI check

class _Fake:
    def __init__(self, data=None, error=None):
        self.data, self.error, self.prompt = data, error, None

    def analyze(self, prompt):
        self.prompt = prompt
        if self.error:
            raise self.error
        return AnalyzerResult(data=self.data, model="fake")


def test_ai_check(as_role, setup, db, monkeypatch):
    monkeypatch.setattr(specs_routes, "run_in_session", lambda fn, *a: fn(db, *a))
    fake = _Fake({"criteria": [
        {"index": 1, "verdict": "met", "evidence": "abcdef12 adds the counter"},
        {"index": 2, "verdict": "bogus"},
    ], "summary": "Lockout done; email unclear."})
    monkeypatch.setattr(analyzers, "get_analyzer", lambda *a, **k: fake)
    fr1, fr2 = setup["fr1"], setup["fr2"]

    assert as_role("tech_lead").post(f"/api/requirements/{fr2.id}/ai-check").status_code == 400
    assert as_role("developer").post(f"/api/requirements/{fr1.id}/ai-check").status_code == 403
    assert as_role("tech_lead").post(f"/api/requirements/{fr1.id}/ai-check").status_code == 202
    assert "AUTH-3" in fake.prompt and "abcdef12" in fake.prompt
    assert "Adds lockout after 5 failed logins" in fake.prompt

    fr = _detail(as_role, setup["spec"].id)["FR-1"]
    assert fr["ai_check_status"] == "ready"
    assert [c["verdict"] for c in fr["ai_check"]["criteria"]] == ["met", "not_evident"]
    assert fr["ai_check"]["summary"].startswith("Lockout done")
    assert fr["status"] == "implemented"  # suggestions never tick anything


def test_ai_check_failure_and_reset_on_change(as_role, setup, db, monkeypatch):
    monkeypatch.setattr(specs_routes, "run_in_session", lambda fn, *a: fn(db, *a))
    monkeypatch.setattr(analyzers, "get_analyzer",
                        lambda *a, **k: _Fake(error=AnalyzerError("not logged in")))
    fr1 = setup["fr1"]
    as_role("tech_lead").post(f"/api/requirements/{fr1.id}/ai-check")
    fr = _detail(as_role, setup["spec"].id)["FR-1"]
    assert fr["ai_check_status"] == "failed" and "not logged in" in fr["ai_check_error"]

    # A ready check is dropped when the requirement changes in a new version.
    db.expire_all()
    req = db.get(Requirement, fr1.id)
    req.ai_check, req.ai_check_status = {"criteria": [], "summary": "old"}, "ready"
    db.commit()
    spec = db.get(Spec, setup["spec"].id)
    specs.apply_version(db, spec, [
        spec_diff.Parsed("FR-1", True, "Lockout", "x", source_excerpt="Lock accounts after 3 tries."),
        spec_diff.Parsed("FR-2", True, "Audit log", "Log every login."),
    ], text="v2", file_id=None)
    db.commit()
    db.expire_all()
    req = db.get(Requirement, fr1.id)
    assert req.change_state == "changed" and req.ai_check is None and req.ai_check_status == "none"


# ------------------------------------------------------------ untraced work

def test_untraced_work(as_role, setup, db, world):
    pid = setup["pid"]
    today = date.today()
    old = Sprint(project_id=pid, name="S1", state="closed", source="local",
                 start_date=today - timedelta(days=40), end_date=today - timedelta(days=27))
    last = Sprint(project_id=pid, name="S2", state="closed", source="local",
                  start_date=today - timedelta(days=26), end_date=today - timedelta(days=13))
    active = Sprint(project_id=pid, name="S3", state="active", source="local",
                    start_date=today - timedelta(days=12), end_date=today + timedelta(days=2))
    db.add_all([old, last, active])
    db.flush()

    def task(title, sprint, **kw):
        t = Task(project_id=pid, title=title, source="local", sprint_id=sprint.id,
                 status="To Do", status_category=TODO, **kw)
        db.add(t)
        db.flush()
        return t

    task("Stray work", active)
    epic = task("Epic", active)
    task("Child of epic", active, parent_id=epic.id)
    traced = task("Traced", active)
    task("Ancient", old)
    task("Recent closed", last)
    db.add(RequirementTask(requirement_id=setup["fr2"].id, task_id=traced.id))
    db.commit()

    rows = as_role("developer").get(f"/api/projects/{pid}/specs/untraced").json()
    titles = {r["title"] for r in rows}
    assert titles == {"Stray work", "Child of epic", "Recent closed"}
    assert next(r for r in rows if r["title"] == "Recent closed")["sprint_name"] == "S2"
    assert as_role("outsider").get(f"/api/projects/{world['other_project']}/specs/untraced").json() == []


# ------------------------------------------------- portfolio / exec report

def test_project_coverage_and_stale_reviews(setup, db):
    pid, fr1, task = setup["pid"], setup["fr1"], setup["task"]
    cov, rows, stale = spec_verify.project_coverage(db, pid)
    assert (cov.total, cov.linked, cov.implemented) == (2, 1, 1) and stale == 0
    assert [r.title for r in rows] == ["Auth"]
    assert spec_verify.must_gaps(db, pid) == [{"spec": "Auth", "key": "FR-2", "title": "Audit log"}]

    link = db.query(RequirementTask).filter_by(requirement_id=fr1.id, task_id=task.id).one()
    link.needs_review = True
    db.commit()
    assert spec_verify.project_coverage(db, pid)[2] == 0  # within the grace period
    link.updated_at = datetime.now(timezone.utc) - timedelta(days=5)
    db.commit()
    assert spec_verify.project_coverage(db, pid)[2] == 1

    health, reasons = project_health([], None, None, stale_reviews=1)
    assert health == "unknown"  # nothing else to judge by: no sprint, no milestones


def test_portfolio_and_exec_report_show_coverage(as_role, setup, db):
    pid = setup["pid"]
    row = as_role("vp_product").get("/api/portfolio").json()["projects"][0]
    assert row["spec_coverage"]["total"] == 2 and row["spec_coverage"]["implemented"] == 1

    ctx = exec_report.build_executive_context(db, pid, {"kind": "executive"}, narrate=False)
    ctx.charts = build_charts(ctx)
    html = render("reports/executive_report.html.j2", ctx=ctx)
    assert "Specification coverage" in html
    assert "Must-haves with no work planned" in html and "FR-2" in html
    assert "no specs are tracked" not in exec_report._spec_line(ctx.executive)
