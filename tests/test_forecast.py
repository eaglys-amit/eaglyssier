"""Monte Carlo forecast: the simulation itself and its use on the roadmap."""
from __future__ import annotations

from datetime import date, timedelta

from app.models import Milestone, Project, Sprint, StatusCategory, Task
from app.services import forecast
from app.services.milestones import _health, build_roadmap


def test_constant_throughput_is_exact():
    (dist,) = forecast.simulate([25], [10, 10, 10], seed=1)
    assert dist.percentile(0.5) == dist.percentile(0.85) == 3
    assert dist.probability_within(2) == 0.0
    assert dist.probability_within(3) == 1.0


def test_simulation_is_deterministic_and_ordered():
    samples = [3, 8, 13, 5, 0, 9]
    a = forecast.simulate([20, 45], samples, seed=7)
    b = forecast.simulate([20, 45], samples, seed=7)
    assert a == b
    first, second = a
    assert first.percentile(0.5) <= first.percentile(0.85)
    # Shared draws: the later (cumulative) target never lands sooner.
    assert all(x <= y for x, y in zip(first.sprints, second.sprints))


def test_unreachable_target_has_no_date():
    (dist,) = forecast.simulate([10_000], [1, 1, 1], trials=50)
    assert dist.percentile(0.5) is None
    assert dist.probability_within(forecast.MAX_SPRINTS) == 0.0


def test_usable_samples():
    assert forecast.usable_samples([5, 6]) is None
    assert forecast.usable_samples([0, 0, 0]) is None
    assert forecast.usable_samples(list(range(1, 12))) == list(range(4, 12))


def test_capacity_factor():
    assert forecast.capacity_factor([], [10]) == 1.0
    assert forecast.capacity_factor([10, 10], [5]) == 0.5
    assert forecast.capacity_factor([10], [100]) == 1.5  # clamped
    assert forecast.capacity_factor([10], [12]) == 1.2


def test_health_bands():
    common = dict(target_date=date.today() + timedelta(days=30), forecast_date=None,
                  total_points=10, total_tasks=2, completed_tasks=0, state="planned",
                  today=date.today())
    assert _health(**common, on_time_probability=0.9) == "on_track"
    assert _health(**common, on_time_probability=0.5) == "at_risk"
    assert _health(**common, on_time_probability=0.1) == "off_track"
    assert _health(**common) == "unknown"  # no simulation, no projection


def _project_with_history(db, closed_points: list[float]) -> int:
    project = Project(name="F", key="F")
    db.add(project)
    db.flush()
    start = date.today() - timedelta(days=14 * (len(closed_points) + 1))
    for i, pts in enumerate(closed_points):
        s = Sprint(project_id=project.id, name=f"S{i}", state="closed", source="local",
                   start_date=start + timedelta(days=14 * i),
                   end_date=start + timedelta(days=14 * i + 13))
        db.add(s)
        db.flush()
        db.add(Task(project_id=project.id, sprint_id=s.id, title=f"t{i}", source="local",
                    story_points=pts, status_category=StatusCategory.done, status="Done"))
    return project.id


def _milestone(db, pid: int, name: str, points: float, target_days: int) -> None:
    m = Milestone(project_id=pid, name=name, state="planned",
                  target_date=date.today() + timedelta(days=target_days))
    db.add(m)
    db.flush()
    db.add(Task(project_id=pid, milestone_id=m.id, title=name, source="local",
                story_points=points, status_category=StatusCategory.todo, status="To Do"))


def test_roadmap_simulates_with_history(db):
    pid = _project_with_history(db, [10, 12, 8, 10])
    _milestone(db, pid, "First", 20, target_days=60)
    _milestone(db, pid, "Second", 20, target_days=61)
    db.commit()

    roadmap = build_roadmap(db, pid)
    assert roadmap.forecast_samples == 4
    first, second = roadmap.milestones
    assert first.confidence == second.confidence == "high"
    assert first.forecast_p50 <= first.forecast_p85
    # Second waits behind First: 40 cumulative points at ~10/sprint.
    assert second.forecast_p50 > first.forecast_p50
    assert first.on_time_probability > second.on_time_probability
    assert first.forecast_date == first.forecast_p50


def test_roadmap_falls_back_without_history(db):
    pid = _project_with_history(db, [10])
    _milestone(db, pid, "Only", 20, target_days=60)
    db.commit()

    roadmap = build_roadmap(db, pid)
    (m,) = roadmap.milestones
    assert roadmap.forecast_samples == 0
    assert m.confidence == "low"
    assert m.forecast_p50 == m.forecast_p85 == m.forecast_date is not None
    assert m.on_time_probability is None
