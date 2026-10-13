"""Automatic requirement links: AI breakdown tags, key scanning, review queue."""
from __future__ import annotations

from app.models import (
    ReferenceFile,
    Requirement,
    RequirementTask,
    Spec,
    StatusCategory,
    Task,
    TaskBreakdown,
)
from app.services import breakdown as bd
from app.services import specs


def _spec(db, pid, title, keys, *, file_id=None, origin="document"):
    spec = Spec(project_id=pid, title=title, source="document", version=1,
                reference_file_id=file_id, status="approved")
    db.add(spec)
    db.flush()
    reqs = {}
    for i, key in enumerate(keys):
        r = Requirement(spec_id=spec.id, key=key, key_origin=origin, title=f"{key} title",
                        statement=f"{key} statement", acceptance_criteria=[], rank=i)
        db.add(r)
        reqs[key] = r
    db.flush()
    return spec, reqs


def _task(db, pid, title, description=None, **kw):
    t = Task(project_id=pid, title=title, description=description, source="local",
             status="To Do", status_category=StatusCategory.todo, **kw)
    db.add(t)
    db.flush()
    return t


def _links(db):
    db.expire_all()
    return {(lk.requirement.key, lk.task_id, lk.origin) for lk in db.query(RequirementTask)}


# ------------------------------------------------------------------ breakdown

def test_breakdown_keys_are_tidied():
    assert bd._keys([" fr-001 ", "FR-001", "", None, "nfr 2"]) == ["FR-001", "NFR2"]
    assert bd._keys("FR-001") == []


def test_accepting_a_breakdown_links_tagged_requirements(db, world):
    pid = world["project"]
    doc = ReferenceFile(project_id=pid, filename="prd.md", content_type="text/markdown",
                        kind="md", storage_key="k", extracted_text="x", extract_status="ready")
    db.add(doc)
    db.flush()
    _, reqs = _spec(db, pid, "PRD", ["FR-001", "FR-002"], file_id=doc.id)
    db.commit()

    out_reqs = specs.requirements_for_files(db, [doc.id])
    assert [r.key for r in out_reqs] == ["FR-001", "FR-002"]

    row = TaskBreakdown(project_id=pid, title="b", reference_file_ids=[doc.id], status="ready",
                        draft={"nodes": [
                            {"id": "e", "parent": None, "level": "epic", "title": "Epic",
                             "requirement_keys": ["FR-001"]},
                            {"id": "t", "parent": "e", "level": "task", "title": "Task",
                             "story_points": 3, "requirement_keys": ["FR-002", "FR-999"]},
                            {"id": "u", "parent": None, "level": "task", "title": "Untagged"},
                        ]})
    db.add(row)
    db.commit()
    created, _ = bd.accept_breakdown(db, row, ["e", "t", "u"], None)
    by_title = {t.title: t.id for t in created}
    assert _links(db) == {
        ("FR-001", by_title["Epic"], "ai"),
        ("FR-002", by_title["Task"], "ai"),  # FR-999 isn't a real key: skipped
    }


def test_normalize_keeps_requirement_keys():
    nodes = bd.normalize_nodes(
        {"nodes": [{"id": "a", "title": "A", "story_points": 3, "requirement_keys": ["fr-1"]}]},
        [1, 2, 3, 5],
    )
    assert nodes[0]["requirement_keys"] == ["FR-1"]


# --------------------------------------------------------------- key scanning

def test_scan_links_unique_keys_and_rederives(db, world):
    pid = world["project"]
    _, a = _spec(db, pid, "Auth", ["FR-001", "REQ-7"])
    _spec(db, pid, "Albums", ["FR-001"])                     # FR-001 now ambiguous
    _spec(db, pid, "Gen", ["R-1"], origin="generated")
    t1 = _task(db, pid, "Implement REQ-7 login lockout")
    t2 = _task(db, pid, "Refactor", description="covers req-7 and FR-001")
    t3 = _task(db, pid, "Bump REQ-70 dependency")           # not REQ-7
    _task(db, pid, "Do R-1 thing")                           # generated keys aren't scanned
    db.add(RequirementTask(requirement_id=a["FR-001"].id, task_id=t3.id, origin="manual"))
    db.commit()

    result = specs.scan_task_references(db, pid)
    db.commit()
    assert result == {"linked": 2, "removed": 0, "ambiguous_keys": 1}
    assert _links(db) == {
        ("REQ-7", t1.id, "key_match"),
        ("REQ-7", t2.id, "key_match"),
        ("FR-001", t3.id, "manual"),
    }

    # The ticket stops citing the key: its key_match link goes; manual ones stay.
    t2.description = "covers something else"
    db.commit()
    assert specs.scan_task_references(db, pid)["removed"] == 1
    db.commit()
    assert ("REQ-7", t2.id, "key_match") not in _links(db)
    assert ("FR-001", t3.id, "manual") in _links(db)


def test_scan_endpoint_rights(as_role, world, db):
    pid = world["project"]
    _spec(db, pid, "Auth", ["REQ-1"])
    _task(db, pid, "REQ-1 work")
    db.commit()
    url = f"/api/projects/{pid}/specs/scan-references"
    assert as_role("vp_product").post(url).status_code == 403
    r = as_role("developer").post(url)
    assert r.status_code == 200 and r.json()["linked"] == 1


# --------------------------------------------------------------- review queue

def test_review_queue(as_role, world, db):
    pid = world["project"]
    _, reqs = _spec(db, pid, "Auth", ["FR-001", "FR-002"])
    reqs["FR-001"].change_state, reqs["FR-001"].changed_in_version = "changed", 2
    t = _task(db, pid, "Login")
    db.add_all([
        RequirementTask(requirement_id=reqs["FR-001"].id, task_id=t.id, needs_review=True),
        RequirementTask(requirement_id=reqs["FR-002"].id, task_id=t.id),
    ])
    db.commit()
    queue = as_role("vp_product").get(f"/api/projects/{pid}/specs/review").json()
    assert [(i["key"], i["task_id"], i["change_state"]) for i in queue] == [("FR-001", t.id, "changed")]

    rid = reqs["FR-001"].id
    assert as_role("developer").post(f"/api/requirements/{rid}/tasks/{t.id}/reviewed").status_code == 204
    assert as_role("vp_product").get(f"/api/projects/{pid}/specs/review").json() == []
