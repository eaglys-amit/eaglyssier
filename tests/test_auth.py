"""Login, sessions, passwords and user administration."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import update

from app.main import app
from app.models import User, UserSession
from app.services import auth as auth_svc
from tests.conftest import PASSWORD


def test_password_hash_roundtrip():
    stored = auth_svc.hash_password("s3cret-pass")
    assert stored.startswith("scrypt$")
    assert auth_svc.verify_password("s3cret-pass", stored)
    assert not auth_svc.verify_password("wrong", stored)
    assert not auth_svc.verify_password("s3cret-pass", "garbage")


def test_api_requires_login(client, world):
    assert client.get("/api/projects").status_code == 401
    assert client.get(f"/api/projects/{world['project']}/sprints").status_code == 401


def test_login_me_logout(client, world):
    r = client.post("/api/auth/login", json={"email": "Developer@T.dev ", "password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["memberships"] == [{"project_id": world["project"], "role": "developer"}]
    assert client.get("/api/auth/me").json()["email"] == "developer@t.dev"
    assert client.get("/api/projects").status_code == 200

    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_bad_credentials_and_inactive_user(client, world, db):
    bad = client.post("/api/auth/login", json={"email": "developer@t.dev", "password": "nope"})
    assert bad.status_code == 401
    unknown = client.post("/api/auth/login", json={"email": "who@t.dev", "password": PASSWORD})
    assert unknown.status_code == 401

    db.execute(update(User).where(User.email == "developer@t.dev").values(is_active=False))
    db.commit()
    r = client.post("/api/auth/login", json={"email": "developer@t.dev", "password": PASSWORD})
    assert r.status_code == 401


def test_expired_session_rejected(as_role, db):
    c = as_role("developer")
    db.execute(update(UserSession).values(
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)
    ))
    db.commit()
    assert c.get("/api/auth/me").status_code == 401


def test_change_password_signs_out_other_sessions(as_role):
    first, second = as_role("developer"), as_role("developer")
    r = first.post("/api/auth/password",
                   json={"current_password": PASSWORD, "new_password": "brand-new-pass"})
    assert r.status_code == 204
    assert first.get("/api/auth/me").status_code == 200
    assert second.get("/api/auth/me").status_code == 401


def test_admin_manages_users(as_role, world):
    admin = as_role("admin")
    r = admin.post("/api/users", json={"email": "new@t.dev", "password": "short"})
    assert r.status_code == 400
    r = admin.post("/api/users", json={"email": "new@t.dev", "password": "long-enough"})
    assert r.status_code == 201
    assert admin.post("/api/users", json={"email": "NEW@t.dev", "password": "long-enough"}) \
        .status_code == 409

    me = admin.get("/api/auth/me").json()
    assert admin.patch(f"/api/users/{me['id']}", json={"is_admin": False}).status_code == 400

    assert as_role("project_manager").get("/api/users").status_code == 403


def test_deactivating_user_ends_their_sessions(as_role, db):
    dev = as_role("developer")
    admin = as_role("admin")
    dev_id = db.query(User).filter_by(email="developer@t.dev").one().id
    assert admin.patch(f"/api/users/{dev_id}", json={"is_active": False}).status_code == 200
    assert dev.get("/api/auth/me").status_code == 401


def test_enroll_everywhere(as_role, world, db):
    admin = as_role("admin")
    vp_id = db.query(User).filter_by(email="vp_product@t.dev").one().id
    r = admin.post(f"/api/users/{vp_id}/memberships", json={"role": "vp_product"})
    assert r.status_code == 200
    vp = TestClient(app)
    vp.post("/api/auth/login", json={"email": "vp_product@t.dev", "password": PASSWORD})
    names = {p["name"] for p in vp.get("/api/projects").json()}
    assert names == {"Alpha", "Beta"}
