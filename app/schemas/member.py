"""Member / project-membership / identity-mapping API schemas."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas.common import ApiModel


class MemberOut(ApiModel):
    id: int
    display_name: str
    primary_email: str | None


class MemberCreate(BaseModel):
    display_name: str
    primary_email: str | None = None


class MemberPatch(BaseModel):
    display_name: str


class IdentityOut(ApiModel):
    id: int
    system: str
    external_id: str
    username: str | None
    email: str | None
    display_name: str | None
    member_id: int | None


class PlatformIdentities(BaseModel):
    platform: str
    label: str
    accounts: list[IdentityOut]


class ProjectMembersOut(BaseModel):
    members: list[MemberOut]
    available: list[MemberOut]
    identities: list[PlatformIdentities]


class ProjectMemberAdd(BaseModel):
    member_id: int


class IdentityMappingIn(BaseModel):
    member_id: int | None = None


class MemberSyncCandidate(BaseModel):
    """A discovered account and the member it probably belongs to.

    `confidence`: exact = matched on email (the only identifier both sides
    genuinely share); likely = a unique display-name or username hit; none = no
    proposal, the user picks or creates.
    """
    identity_id: int
    system: str
    external_id: str
    username: str | None
    email: str | None
    display_name: str | None
    current_member_id: int | None
    match_member_id: int | None
    match_display_name: str | None
    match_reason: Literal["email", "username", "display_name"] | None
    confidence: Literal["exact", "likely", "none"]
    # False when the proposed member isn't on this project yet — applying the
    # match enrolls them, which is worth showing before it happens.
    match_on_project: bool = False
    # Prefilled name if the user chooses to create a member for this account.
    suggested_display_name: str


class MemberSyncPreview(BaseModel):
    candidates: list[MemberSyncCandidate] = []
    total: int = 0
    already_mapped: int = 0
    matched: int = 0
    unmatched: int = 0


class MemberSyncMapping(BaseModel):
    identity_id: int
    # None unmaps the account.
    member_id: int | None = None


class MemberSyncCreate(BaseModel):
    """Create a member for this account and map it in one step."""
    identity_id: int
    display_name: str
    primary_email: str | None = None


class MemberSyncApplyIn(BaseModel):
    mappings: list[MemberSyncMapping] = []
    create_members: list[MemberSyncCreate] = []


class MemberSyncApplyOut(BaseModel):
    created: int
    mapped: int
    unmapped: int
