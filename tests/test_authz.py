"""Route policy and per-project role enforcement."""
from __future__ import annotations

import importlib
import pkgutil

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import authz, routes
from app.main import app
from app.models import Milestone


def _api_routes():
    for info in pkgutil.iter_modules(routes.__path__):
        if info.name == "auth":
            continue  # mounted outside the authorized router
        module = importlib.import_module(f"app.api.routes.{info.name}")
        for route in module.router.routes:
            for method in route.methods - {"HEAD"}:
                yield method, route.path


def test_every_route_has_an_explicit_rule():
    uncovered = [f"{m} {p}" for m, p in _api_routes() if authz.rule_for(m, p) is None]
    assert uncovered == []


def test_policy_spot_checks():
    rule = authz.rule_for
    assert rule("GET", "/projects/{project_id}/evaluation") is authz.Cap.PEOPLE
    assert rule("GET", "/projects/{project_id}/sprints") is authz.Cap.VIEW
    assert rule("POST", "/poker/rounds/{round_id}/vote") is authz.Cap.POKER_VOTE
    assert rule("POST", "/poker/rounds/{round_id}/reveal") is authz.Cap.POKER_FACILITATE
    assert rule("PUT", "/projects/{project_id}/integrations/{itype}") is authz.Cap.ADMIN
    assert rule("POST", "/integrations/{integration_id}/sync") is authz.Cap.OPS
    assert rule("GET", "/users") is authz.Cap.ADMIN


def test_project_list_follows_membership(as_role):
    assert [p["name"] for p in as_role("developer").get("/api/projects").json()] == ["Alpha"]
    assert [p["name"] for p in as_role("outsider").get("/api/projects").json()] == ["Beta"]
    assert len(as_role("admin").get("/api/projects").json()) == 2


def test_non_member_gets_404(as_role, world):
    r = as_role("outsider").get(f"/api/projects/{world['project']}/sprints")
    assert r.status_code == 404


def test_entity_from_another_project_is_rejected(as_role, world, db):
    foreign = Milestone(project_id=world["other_project"], name="Elsewhere")
    db.add(foreign)
    db.commit()
    r = as_role("admin").get(
        f"/api/projects/{world['project']}/milestones/{foreign.id}/tasks"
    )
    assert r.status_code == 404


# (method, path template, body, {role: expected status})
MATRIX = [
    ("PATCH", "/api/projects/{project}", {}, {
        "vp_product": 403, "tech_lead": 200, "project_manager": 200, "developer": 403,
    }),
    ("PUT", "/api/projects/{project}/members/{developer}/role", {"role": "tech_lead"}, {
        "vp_product": 403, "tech_lead": 403, "project_manager": 204, "developer": 403,
    }),
    ("GET", "/api/projects/{project}/evaluation", None, {
        "vp_product": 403, "tech_lead": 200, "project_manager": 200, "developer": 200,
    }),
    ("GET", "/api/projects/{project}/evaluation/{tech_lead}", None, {
        "vp_product": 403, "tech_lead": 200, "project_manager": 200, "developer": 403,
    }),
    ("POST", "/api/projects", {"name": "Gamma"}, {
        "vp_product": 403, "tech_lead": 403, "project_manager": 403, "developer": 403,
        "admin": 201,
    }),
    ("GET", "/api/projects/{project}/integrations", None, {
        "vp_product": 200, "developer": 200,
    }),
]


@pytest.mark.parametrize("method,path,body,expected", MATRIX)
def test_role_matrix(as_role, world, method, path, body, expected):
    url = path.format(project=world["project"], **world["member"])
    for who, status in expected.items():
        r = as_role(who).request(method, url, json=body)
        assert r.status_code == status, f"{who} {method} {url}: {r.status_code} {r.text}"


def test_developer_sees_only_own_people_rows(as_role, world):
    rows = as_role("developer").get(f"/api/projects/{world['project']}/evaluation").json()
    assert [r["member_id"] for r in rows] == [world["member"]["developer"]]
    kpis = as_role("developer").get(f"/api/projects/{world['project']}/kpi").json()
    assert [k["member_id"] for k in kpis] == [world["member"]["developer"]]
    assert len(as_role("tech_lead").get(f"/api/projects/{world['project']}/kpi").json()) == 4


def _put_axis(client, world, member, **cells):
    return client.put(
        f"/api/projects/{world['project']}/evaluation/{world['member'][member]}",
        json={"axes": {"outcomes": cells}},
    )


def test_evaluation_field_rights(as_role, world):
    dev, tl, pm = as_role("developer"), as_role("tech_lead"), as_role("project_manager")
    assert _put_axis(dev, world, "developer", self_eval="A").status_code == 200
    r = _put_axis(dev, world, "developer", self_eval="A", final_eval="S")
    assert r.status_code == 403 and "final_eval" in r.text

    assert _put_axis(tl, world, "developer", self_eval="A", tech_lead_eval="B").status_code == 200
    r = _put_axis(tl, world, "developer", self_eval="B", tech_lead_eval="B")
    assert r.status_code == 403 and "self_eval" in r.text

    r = _put_axis(pm, world, "developer", self_eval="A", tech_lead_eval="B", final_eval="B")
    assert r.status_code == 200


def test_report_artifacts_require_login(client, world):
    assert client.get("/reports/1/view").status_code == 401


def test_terminal_websocket_requires_tech_lead(as_role, world, db, monkeypatch):
    monkeypatch.setattr(authz, "get_db", app.dependency_overrides[authz.get_db])
    url = f"/projects/{world['project']}/terminal/ws"
    for client in (TestClient(app), as_role("developer"), as_role("vp_product")):
        with pytest.raises(WebSocketDisconnect), client.websocket_connect(url):
            pass
