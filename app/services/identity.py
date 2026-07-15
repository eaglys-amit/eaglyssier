"""Project-scoped external-account discovery.

During sync, every external account seen (a Jira assignee, a git author) is
upserted as a project-scoped MemberIdentity — a "discovered account". It is NOT
linked to a curated Member automatically; that mapping is done by hand in the
project UI. Synced rows reference the identity, so mapping an account to a member
(setting MemberIdentity.member_id) re-attributes all history through the join.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.connectors.dto import IdentityDTO
from app.models import IntegrationType, MemberIdentity


def resolve_identity(
    db: Session, project_id: int, system: IntegrationType, dto: IdentityDTO | None
) -> MemberIdentity | None:
    """Upsert the discovered account for (project, system, external_id) and return it.

    Refreshes the account's display fields from the latest sync but preserves any
    existing member mapping. Never creates a Member.
    """
    if dto is None or not dto.external_id:
        return None

    identity = db.execute(
        select(MemberIdentity).where(
            MemberIdentity.project_id == project_id,
            MemberIdentity.system == system,
            MemberIdentity.external_id == str(dto.external_id),
        )
    ).scalar_one_or_none()

    if identity is None:
        identity = MemberIdentity(
            project_id=project_id,
            system=system,
            external_id=str(dto.external_id),
            username=dto.username,
            email=dto.email,
            display_name=dto.display_name,
        )
        db.add(identity)
        db.flush()
    else:
        # keep member_id; refresh the human-facing fields from the latest sync
        identity.username = dto.username or identity.username
        identity.email = dto.email or identity.email
        identity.display_name = dto.display_name or identity.display_name
    return identity
