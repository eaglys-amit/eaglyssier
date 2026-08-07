"""Project membership and discovered-account identity mapping."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Member, MemberIdentity, Project, ProjectMember
from app.schemas.member import (
    IdentityMappingIn,
    IdentityOut,
    MemberOut,
    MemberSyncApplyIn,
    MemberSyncApplyOut,
    MemberSyncPreview,
    PlatformIdentities,
    ProjectMemberAdd,
    ProjectMembersOut,
)
from app.services import member_sync

router = APIRouter()

# Platform label lookup for the mapping UI (order matters).
PLATFORM_LABELS = [
    ("jira", "Jira"), ("github", "GitHub"), ("gitlab", "GitLab"),
    ("google", "Google Workspace"), ("slack", "Slack"),
]


@router.get("/projects/{project_id}/members", response_model=ProjectMembersOut)
def project_members(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    members = db.execute(
        select(Member)
        .join(ProjectMember, ProjectMember.member_id == Member.id)
        .where(ProjectMember.project_id == project_id)
        .order_by(Member.display_name)
    ).scalars().all()
    member_ids = {m.id for m in members}
    available = [
        m
        for m in db.execute(select(Member).order_by(Member.display_name)).scalars()
        if m.id not in member_ids
    ]

    identities = db.execute(
        select(MemberIdentity)
        .where(MemberIdentity.project_id == project_id)
        .order_by(MemberIdentity.display_name, MemberIdentity.username)
    ).scalars().all()
    by_platform: dict[str, list[MemberIdentity]] = {}
    for ident in identities:
        by_platform.setdefault(ident.system.value, []).append(ident)

    return ProjectMembersOut(
        members=[MemberOut.model_validate(m) for m in members],
        available=[MemberOut.model_validate(m) for m in available],
        identities=[
            PlatformIdentities(
                platform=key,
                label=label,
                accounts=[IdentityOut.model_validate(i) for i in by_platform[key]],
            )
            for key, label in PLATFORM_LABELS
            if key in by_platform
        ],
    )


@router.post("/projects/{project_id}/members", status_code=201)
def add_project_member(project_id: int, body: ProjectMemberAdd, db: Session = Depends(get_db)):
    """Add a global member to this project (idempotent)."""
    get_or_404(db, Project, project_id)
    get_or_404(db, Member, body.member_id)
    exists = db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.member_id == body.member_id
        )
    ).scalar_one_or_none()
    if exists is None:
        db.add(ProjectMember(project_id=project_id, member_id=body.member_id))
        db.commit()
    return {"ok": True}


@router.delete("/projects/{project_id}/members/{member_id}", status_code=204)
def remove_project_member(project_id: int, member_id: int, db: Session = Depends(get_db)):
    """Remove a member from the project and unmap their accounts in this project."""
    link = db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.member_id == member_id
        )
    ).scalar_one_or_none()
    if link is not None:
        for ident in db.execute(
            select(MemberIdentity).where(
                MemberIdentity.project_id == project_id,
                MemberIdentity.member_id == member_id,
            )
        ).scalars():
            ident.member_id = None
        db.delete(link)
        db.commit()


@router.put("/projects/{project_id}/identities/{identity_id}/mapping", response_model=IdentityOut)
def map_identity(
    project_id: int,
    identity_id: int,
    body: IdentityMappingIn,
    db: Session = Depends(get_db),
):
    """Map a discovered account to a project member (null = unmap)."""
    ident = db.get(MemberIdentity, identity_id)
    if ident is None or ident.project_id != project_id:
        raise HTTPException(404, "Account not found in this project")
    if body.member_id is None:
        ident.member_id = None
    else:
        target = db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.member_id == body.member_id,
            )
        ).scalar_one_or_none()
        if target is None:
            raise HTTPException(400, "That member is not on this project")
        ident.member_id = body.member_id
    db.commit()
    return ident


@router.get("/projects/{project_id}/members/sync-preview", response_model=MemberSyncPreview)
def member_sync_preview(project_id: int, db: Session = Depends(get_db)):
    """Proposed identity -> member matches, for review before anything is written.

    Read-only on purpose: sync has never invented a member, and auto-applying a
    name-based guess would quietly attribute one person's work to another.
    """
    get_or_404(db, Project, project_id)
    return member_sync.build_preview(db, project_id)


@router.post("/projects/{project_id}/members/sync-apply", response_model=MemberSyncApplyOut)
def member_sync_apply(
    project_id: int, body: MemberSyncApplyIn, db: Session = Depends(get_db)
):
    """Write the mappings the user confirmed, creating/enrolling members as asked."""
    get_or_404(db, Project, project_id)
    return member_sync.apply_mappings(db, project_id, body)
