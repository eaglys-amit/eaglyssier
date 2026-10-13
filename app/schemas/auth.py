"""Login, current-user and user-administration schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ApiModel


class LoginIn(BaseModel):
    email: str
    password: str


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


class MembershipOut(BaseModel):
    project_id: int
    role: str


class MeOut(BaseModel):
    id: int
    email: str
    is_admin: bool
    member_id: int | None
    display_name: str
    memberships: list[MembershipOut]


class UserOut(ApiModel):
    id: int
    email: str
    is_admin: bool
    is_active: bool
    member_id: int | None
    member_name: str | None = None
    last_login_at: datetime | None


class UserCreate(BaseModel):
    email: str
    password: str
    is_admin: bool = False
    member_id: int | None = None


class UserPatch(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None
    # Link to this member; `unlink_member` clears the link instead.
    member_id: int | None = None
    unlink_member: bool = False
    password: str | None = None


class BulkMembershipIn(BaseModel):
    """Enroll the user's member in every project with `role` (VP onboarding)."""

    role: str
