"""Per-platform integration configuration (create-or-update), test, delete."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.connectors import build_connector
from app.connectors.base import ConnectorError
from app.db import get_db
from app.models import Integration, IntegrationType, Project
from app.schemas.integration import (
    IntegrationIn,
    IntegrationOut,
    IntegrationTypeOut,
    ProjectIntegrationsOut,
    TestResultOut,
)
from app.services.crypto import encrypt

router = APIRouter()

# Platforms that accept configuration in iteration 1 (Slack/Google are stubs).
CONFIGURABLE = {IntegrationType.jira, IntegrationType.github, IntegrationType.gitlab}

_TYPE_LABELS = {
    "jira": "Jira", "github": "GitHub", "gitlab": "GitLab",
    "slack": "Slack", "google": "Google Workspace",
}


def integration_out(integ: Integration) -> IntegrationOut:
    return IntegrationOut(
        id=integ.id,
        type=integ.type.value,
        base_url=integ.base_url,
        enabled=integ.enabled,
        config=integ.config or {},
        has_credentials=bool(integ.credentials_enc),
    )


def _clean_list(raw) -> list[str]:
    """Accept a real list or a newline/comma-separated string."""
    if isinstance(raw, str):
        raw = raw.replace(",", "\n").splitlines()
    if not isinstance(raw, list):
        return []
    return [str(p).strip() for p in raw if str(p).strip()]


def _int_or_none(raw):
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _build_config(itype: IntegrationType, raw: dict) -> dict:
    if itype == IntegrationType.jira:
        cfg = {
            "email": str(raw.get("email", "")).strip(),
            "project_key": str(raw.get("project_key", "")).strip(),
        }
        board = _int_or_none(raw.get("board_id"))
        if board is not None:
            cfg["board_id"] = board
        spf = str(raw.get("story_points_field", "") or "").strip()
        if spf:
            cfg["story_points_field"] = spf
        return cfg
    if itype == IntegrationType.github:
        cfg = {"repos": _clean_list(raw.get("repos", []))}
        mc = _int_or_none(raw.get("max_commits"))
        if mc is not None:
            cfg["max_commits"] = mc
        return cfg
    if itype == IntegrationType.gitlab:
        cfg = {"projects": _clean_list(raw.get("projects", []))}
        mc = _int_or_none(raw.get("max_commits"))
        if mc is not None:
            cfg["max_commits"] = mc
        return cfg
    return {}


@router.get("/projects/{project_id}/integrations", response_model=ProjectIntegrationsOut)
def list_integrations(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    items = db.execute(
        select(Integration).where(Integration.project_id == project_id)
    ).scalars().all()
    return ProjectIntegrationsOut(
        types=[
            IntegrationTypeOut(
                key=t.value,
                label=_TYPE_LABELS[t.value],
                configurable=t in CONFIGURABLE,
            )
            for t in IntegrationType
        ],
        items=[integration_out(i) for i in items],
    )


@router.put("/projects/{project_id}/integrations/{itype}", response_model=IntegrationOut)
def save_integration(
    project_id: int,
    itype: str,
    body: IntegrationIn,
    db: Session = Depends(get_db),
):
    try:
        integ_type = IntegrationType(itype)
    except ValueError:
        raise HTTPException(400, f"Unknown integration type {itype}")
    if integ_type not in CONFIGURABLE:
        raise HTTPException(400, f"{itype} is not configurable yet")
    get_or_404(db, Project, project_id)

    integration = db.execute(
        select(Integration).where(
            Integration.project_id == project_id, Integration.type == integ_type
        )
    ).scalar_one_or_none()
    if integration is None:
        integration = Integration(project_id=project_id, type=integ_type)
        db.add(integration)

    integration.base_url = (body.base_url or "").strip() or None
    integration.config = _build_config(integ_type, body.config or {})
    integration.enabled = body.enabled
    if body.token and body.token.strip():  # blank token = keep existing credentials
        integration.credentials_enc = encrypt(body.token.strip())
    db.commit()
    return integration_out(integration)


@router.post("/integrations/{integration_id}/test", response_model=TestResultOut)
def test_connection(integration_id: int, db: Session = Depends(get_db)):
    """Verify credentials without syncing."""
    integ = get_or_404(db, Integration, integration_id)
    try:
        ok = build_connector(integ).test_connection()
        message = "Connection OK" if ok else "Connection failed"
    except (ConnectorError, Exception) as exc:  # noqa: BLE001
        ok, message = False, str(exc)[:300]
    return TestResultOut(ok=bool(ok), message=message)


@router.delete("/integrations/{integration_id}", status_code=204)
def delete_integration(integration_id: int, db: Session = Depends(get_db)):
    integ = db.get(Integration, integration_id)
    if integ:
        db.delete(integ)
        db.commit()
