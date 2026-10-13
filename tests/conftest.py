"""Test fixtures: an isolated database, an app client and per-role logins.

Defaults to in-memory SQLite (schema from the models) so tests run anywhere;
set TEST_DATABASE_URL to an empty Postgres database to run against the real
engine (schema still created from the models, not migrations).
"""
from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import get_db
from app.main import app
from app.models import Base, Member, Project, ProjectMember, User
from app.services.auth import hash_password

PASSWORD = "test-password"
ROLES = ("vp_product", "tech_lead", "project_manager", "developer")


@pytest.fixture
def engine():
    url = os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    kwargs = {"poolclass": StaticPool, "connect_args": {"check_same_thread": False}} \
        if url.startswith("sqlite") else {}
    eng = create_engine(url, **kwargs)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture
def db(engine) -> Iterator[Session]:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()

    def _get_db():
        s = factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    yield session
    session.close()
    app.dependency_overrides.clear()


@pytest.fixture
def world(db: Session) -> dict:
    """Two projects; one member+login per role on project A; an admin; an outsider.

    Returns ids under keys: project, other_project, admin, outsider and each role.
    """
    project = Project(name="Alpha", key="ALPHA")
    other = Project(name="Beta", key="BETA")
    db.add_all([project, other])
    db.flush()
    out: dict = {"project": project.id, "other_project": other.id, "member": {}}
    for role in (*ROLES, "outsider"):
        member = Member(display_name=role.title(), primary_email=f"{role}@t.dev")
        db.add(member)
        db.flush()
        if role != "outsider":
            db.add(ProjectMember(project_id=project.id, member_id=member.id, role=role))
        else:
            db.add(ProjectMember(project_id=other.id, member_id=member.id, role="developer"))
        db.add(User(email=f"{role}@t.dev", password_hash=hash_password(PASSWORD),
                    member_id=member.id))
        out["member"][role] = member.id
    db.add(User(email="admin@t.dev", password_hash=hash_password(PASSWORD), is_admin=True))
    db.commit()
    return out


@pytest.fixture
def client(db) -> TestClient:
    return TestClient(app)


def login(client: TestClient, who: str) -> TestClient:
    r = client.post("/api/auth/login", json={"email": f"{who}@t.dev", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def as_role(db, world):
    """Factory: a fresh client logged in as `who` (a role name, 'admin' or 'outsider')."""
    def make(who: str) -> TestClient:
        return login(TestClient(app), who)
    return make
