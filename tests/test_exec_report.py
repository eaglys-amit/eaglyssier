"""Executive report: narrative parsing, context, rendering, API and schedule."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.api.routes import reports as reports_routes
from app.models import Milestone, Project, Report, Sprint, StatusCategory, Task
from app.reporting.charts import build_charts
from app.scheduler import weekly_exec_scope
from app.services import analyzers, exec_report
from app.services.analyzers import AnalyzerError, AnalyzerResult
from app.templating import render


def test_parse_narrative_keeps_good_items_only():
    n = exec_report.parse_narrative({
        "headline": " On track for launch. ",
        "shipped": ["Checkout API", "", 3, *[f"x{i}" for i in range(10)]],
        "risks": [{"risk": "Vendor delay", "impact": "Launch", "mitigation": ""}, {"impact": "?"}],
        "decisions": "not a list",
    })
    assert n.headline == "On track for launch."
    assert n.shipped[:2] == ["Checkout API", "3"] and len(n.shipped) == exec_report.MAX_ITEMS
    assert [r.risk for r in n.risks] == ["Vendor delay"] and n.risks[0].mitigation is None
    assert n.decisions == []
    with pytest.raises(AnalyzerError):
        exec_report.parse_narrative({"shipped": []})


def _seed(db) -> int:
    project = Project(name="Gamma", key="GAM")
    db.add(project)
    db.flush()
    sprint = Sprint(project_id=project.id, name="S1", state="active", source="local",
                    start_date=date.today() - timedelta(days=5),
                    end_date=date.today() + timedelta(days=9), committed_points=10)
    db.add(sprint)
    db.flush()
    epic = Task(project_id=project.id, title="Payments", source="local")
    db.add(epic)
    db.flush()
    db.add_all([
        Task(project_id=project.id, sprint_id=sprint.id, parent_id=epic.id, title="Retry logic",
             source="local", story_points=5, status_category=StatusCategory.done, status="Done"),
        Task(project_id=project.id, sprint_id=sprint.id, title="Docs", source="local",
             story_points=5, status_category=StatusCategory.todo, status="To Do"),
    ])
    db.add(Milestone(project_id=project.id, name="Launch", state="planned",
                     target_date=date.today() + timedelta(days=40)))
    db.commit()
    return project.id


class _FakeAnalyzer:
    def __init__(self, data=None, error=None):
        self.data, self.error = data, error

    def analyze(self, prompt: str) -> AnalyzerResult:
        assert "Retry logic" in prompt  # the model sees the period's finished work
        if self.error:
            raise self.error
        return AnalyzerResult(data=self.data, model="fake-1")


def _render(db, pid, monkeypatch, analyzer) -> tuple:
    monkeypatch.setattr(analyzers, "get_analyzer", lambda *a, **k: analyzer)
    ctx = exec_report.build_executive_context(db, pid, {"kind": "executive"})
    ctx.charts = build_charts(ctx)
    return ctx, render("reports/executive_report.html.j2", ctx=ctx)


def test_renders_from_data_when_narrative_fails(db, monkeypatch):
    pid = _seed(db)
    ctx, html = _render(db, pid, monkeypatch, _FakeAnalyzer(error=AnalyzerError("CLI not logged in")))
    ex = ctx.executive
    assert ctx.report_type == "executive" and ctx.title == "Gamma — Executive Summary"
    assert ex.narrative is None and "CLI not logged in" in ex.narrative_error
    assert [t.title for t in ex.shipped] == ["Retry logic"] and ex.shipped[0].epic == "Payments"
    assert "AI summary unavailable" in html
    assert "Retry logic" in html  # shipped fallback
    assert "Launch" in html and "<svg" in html  # roadmap table + chart
    assert "Not assessed" in html


def test_renders_narrative(db, monkeypatch):
    pid = _seed(db)
    narrative = {
        "headline": "Payments retry shipped; launch looks safe.",
        "shipped": ["Customers' failed payments now retry automatically."],
        "risks": [{"risk": "Docs lag", "impact": "Support load", "mitigation": "Pair on docs"}],
        "decisions": ["Confirm launch market order"],
    }
    ctx, html = _render(db, pid, monkeypatch, _FakeAnalyzer(data=narrative))
    assert ctx.executive.narrative_model == "fake-1"
    for text in ("launch looks safe", "retry automatically", "Pair on docs",
                 "Confirm launch market order", "drafted by AI"):
        assert text in html


def test_create_executive_report_and_schedule(as_role, world, db, monkeypatch):
    monkeypatch.setattr(reports_routes, "run_in_session", lambda *a: None)
    pid = world["project"]
    r = as_role("vp_product").post(f"/api/projects/{pid}/reports",
                                   json={"report_type": "executive", "scope_mode": "project"})
    assert r.status_code == 202
    report = db.get(Report, r.json()["id"])
    assert report.report_type == "executive" and report.scope == {"kind": "executive"}

    url = f"/api/projects/{pid}/reports/executive-schedule"
    assert as_role("developer").put(url, json={"weekly": True}).status_code == 403
    assert as_role("vp_product").put(url, json={"weekly": True}).status_code == 204
    db.expire_all()
    assert db.get(Project, pid).exec_report_weekly is True
    assert as_role("vp_product").get(f"/api/projects/{pid}").json()["exec_report_weekly"] is True


def test_weekly_scope_covers_previous_seven_days():
    assert weekly_exec_scope(date(2026, 10, 19)) == {
        "kind": "executive", "start": "2026-10-12", "end": "2026-10-18",
    }
