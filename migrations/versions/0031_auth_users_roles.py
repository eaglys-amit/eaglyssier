"""logins, sessions and a role per project membership

Until now anyone who could reach the app could read every evaluation sheet and
drive every integration. A VP of Product joining changes that: people now log
in, and what they may do depends on their role on each project.

`users` is the login, linked to the curated `members` row it belongs to — that
link is how a session finds the person's project roles and "their own"
evaluation. A user without a member (a pure admin) holds no project role and
relies on `is_admin` instead.

`user_sessions` keeps a sha256 of the cookie token rather than the token, so a
leaked table cannot be replayed, and logging out is a row delete.

`project_members.role` defaults existing memberships to `developer`, the least
privileged role, so nobody gains access by this migration; an admin promotes
leads and managers afterwards.

Revision ID: 0031_auth_users_roles
Revises: 0030_repo_doc_sets
Create Date: 2026-10-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0031_auth_users_roles"
down_revision: Union[str, None] = "0030_repo_doc_sets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("member_id", sa.Integer(),
                  sa.ForeignKey("members.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("member_id", name="uq_users_member"),
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("token_hash", name="uq_user_sessions_token"),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.add_column(
        "project_members",
        sa.Column("role", sa.String(16), nullable=False, server_default="developer"),
    )


def downgrade() -> None:
    op.drop_column("project_members", "role")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_table("users")
