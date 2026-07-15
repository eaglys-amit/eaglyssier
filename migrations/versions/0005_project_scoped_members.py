"""project-scoped members and identities

Members become hand-curated (UI-created only); MemberIdentity becomes a
project-scoped "discovered account" with an optional mapping to a member; synced
rows reference the identity instead of the member. Existing auto-created member
data is reset (repopulated on re-sync).

Revision ID: 0005_project_scoped_members
Revises: 0004_task_started_at
Create Date: 2026-07-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_project_scoped_members"
down_revision: Union[str, None] = "0004_task_started_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# synced tables whose member FK is replaced by an identity FK
_SYNCED = [
    ("tasks", "assignee_member_id", "assignee_identity_id"),
    ("commits", "author_member_id", "author_identity_id"),
    ("pull_requests", "author_member_id", "author_identity_id"),
    ("pr_reviews", "reviewer_member_id", "reviewer_identity_id"),
]


def upgrade() -> None:
    # 1. project membership join table
    op.create_table(
        "project_members",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("project_id", sa.Integer,
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_id", sa.Integer,
                  sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "member_id", name="uq_project_member"),
    )

    # 2. synced rows: swap member FK -> identity FK (dropping the column drops its FK)
    for table, old_col, new_col in _SYNCED:
        op.drop_column(table, old_col)
        op.add_column(table, sa.Column(new_col, sa.Integer, nullable=True))
        op.create_foreign_key(
            f"{table}_{new_col}_fkey", table, "member_identities",
            [new_col], ["id"], ondelete="SET NULL",
        )

    # 3. member_identities -> project-scoped
    op.add_column("member_identities",
                  sa.Column("project_id", sa.Integer, nullable=True))
    op.drop_constraint("uq_identity_system_external", "member_identities", type_="unique")
    op.drop_constraint("member_identities_member_id_fkey", "member_identities", type_="foreignkey")
    op.create_foreign_key(
        "member_identities_member_id_fkey", "member_identities", "members",
        ["member_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "member_identities_project_id_fkey", "member_identities", "projects",
        ["project_id"], ["id"], ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_identity_project_system_external", "member_identities",
        ["project_id", "system", "external_id"],
    )

    # 4. reset auto-created member data (repopulated on re-sync). DELETE (not
    #    TRUNCATE) so it respects FKs; synced rows' new identity FKs are already NULL.
    op.execute("DELETE FROM member_identities")
    op.execute("DELETE FROM project_members")
    op.execute("DELETE FROM members")

    # 5. now that the table is empty, project_id can be NOT NULL
    op.alter_column("member_identities", "project_id", nullable=False)


def downgrade() -> None:
    op.alter_column("member_identities", "project_id", nullable=True)
    op.drop_constraint("uq_identity_project_system_external", "member_identities", type_="unique")
    op.drop_constraint("member_identities_project_id_fkey", "member_identities", type_="foreignkey")
    op.drop_constraint("member_identities_member_id_fkey", "member_identities", type_="foreignkey")
    op.create_foreign_key(
        "member_identities_member_id_fkey", "member_identities", "members",
        ["member_id"], ["id"], ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_identity_system_external", "member_identities", ["system", "external_id"],
    )
    op.drop_column("member_identities", "project_id")

    for table, old_col, new_col in _SYNCED:
        op.drop_column(table, new_col)
        op.add_column(table, sa.Column(old_col, sa.Integer, nullable=True))
        op.create_foreign_key(
            f"{table}_{old_col}_fkey", table, "members",
            [old_col], ["id"], ondelete="SET NULL",
        )

    op.drop_table("project_members")
