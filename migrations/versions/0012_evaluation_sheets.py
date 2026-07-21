"""add evaluation_sheets table (MBO FORM2 per project member)

Revision ID: 0012_evaluation_sheets
Revises: 0011_repo_sync_state
Create Date: 2026-07-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012_evaluation_sheets"
down_revision: Union[str, None] = "0011_repo_sync_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "evaluation_sheets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "member_id",
            sa.Integer(),
            sa.ForeignKey("members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tech_lead_name", sa.String(length=255), nullable=True),
        sa.Column("axes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column(
            "job_status", sa.String(length=16), nullable=False, server_default="none"
        ),
        sa.Column("job_kind", sa.String(length=16), nullable=True),
        sa.Column("job_error", sa.Text(), nullable=True),
        sa.Column("job_model", sa.String(length=128), nullable=True),
        sa.Column("goals_generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("results_generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checklist", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "member_id", name="uq_eval_project_member"),
    )


def downgrade() -> None:
    op.drop_table("evaluation_sheets")
