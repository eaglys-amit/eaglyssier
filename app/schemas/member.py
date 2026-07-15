"""Member / project-membership / identity-mapping API schemas."""
from __future__ import annotations

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
