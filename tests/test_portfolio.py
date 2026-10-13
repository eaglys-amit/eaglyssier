"""Portfolio: health rules and the cross-project endpoint."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.models import Milestone, Sprint, StatusCategory, Task
from app.schemas.milestone import MilestoneOut
from app.schemas.portfolio import PortfolioSprint
from app.services.portfolio import project_health


def _ms(health: str, *, state: str = "in_progress", days_late: int | None = None) -> MilestoneOut:
    return MilestoneOut(id=1, project_id=1, name="M1", state=state, health=health,
                        days_late=days_late)


def _sprint(scope_change: float | None) -> PortfolioSprint:
    return PortfolioSprint(id=1, name="S1", start_date=None, end_date=None, baseline_points=10,
                           total_points=10, completed_points=5, progress=0.5,
                           scope_change=scope_change)


def test_health_unknown_without_sprint_or_milestones():
    assert project_health([], None, None)[0] == "unknown"
    # Released milestones don't count as something to track.
    assert project_health([_ms("complete", state="released")], None, None)[0] == "unknown"


def test_health_green():
    assert project_health([_ms("on_track")], _sprint(0.05), 1.0) == ("green", [])


def test_health_amber_reasons():
    health, reasons = project_health([_ms("at_risk")], _sprint(0.15), 0.7)
    assert health == "amber"
    assert len(reasons) == 3


def test_health_red_lists_red_reasons_first():
    health, reasons = project_health([_ms("overdue", days_late=9)], _sprint(0.15), None)
    assert health == "red"
    assert reasons[0] == "Milestone “M1” is 9 days late"
    assert "Sprint scope grew 15%" in reasons[1]


def test_health_scope_explosion_is_red():
    assert project_health([], _sprint(0.4), None)[0] == "red"


def test_health_stale_sync_is_amber():
    now = datetime(2026, 10, 13, tzinfo=timezone.utc)
    health, reasons = project_health(
        [_ms("on_track")], None, None, now - timedelta(days=10), now=now
    )
    assert health == "amber" and "10 days" in reasons[0]


def test_portfolio_endpoint(as_role, world, db):
    pid = world["project"]
    sprint = Sprint(project_id=pid, name="Sprint 1", state="active", source="local",
                    start_date=date.today() - timedelta(days=3),
                    end_date=date.today() + timedelta(days=10), committed_points=10)
    db.add(sprint)
    db.flush()
    # 13 points now against a commitment of 10: +30% scope -> red.
    db.add_all([
        Task(project_id=pid, sprint_id=sprint.id, title="a", source="local",
             story_points=8, status_category=StatusCategory.done, status="Done"),
        Task(project_id=pid, sprint_id=sprint.id, title="b", source="local",
             story_points=5, status_category=StatusCategory.todo, status="To Do"),
    ])
    db.add(Milestone(project_id=pid, name="Launch", state="planned",
                     target_date=date.today() + timedelta(days=30)))
    db.commit()

    body = as_role("vp_product").get("/api/portfolio").json()
    assert [p["name"] for p in body["projects"]] == ["Alpha"]
    row = body["projects"][0]
    assert row["role"] == "vp_product"
    assert row["active_sprint"]["total_points"] == 13
    assert row["active_sprint"]["scope_change"] == 0.3
    assert row["health"] == "red"
    assert row["next_milestone"]["name"] == "Launch"

    admin_rows = as_role("admin").get("/api/portfolio").json()["projects"]
    assert {p["name"] for p in admin_rows} == {"Alpha", "Beta"}
    assert as_role("outsider").get("/api/portfolio").json()["projects"][0]["name"] == "Beta"


def test_health_off_track_milestone_is_red_with_chance():
    m = _ms("off_track").model_copy(update={"on_time_probability": 0.12})
    health, reasons = project_health([m], None, None)
    assert health == "red"
    assert reasons == ["Milestone “M1” is unlikely to make its target (12% likely on time)"]
