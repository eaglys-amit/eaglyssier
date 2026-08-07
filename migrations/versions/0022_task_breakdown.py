"""AI-drafted task breakdowns, staged for review before acceptance

The drafted tree lives in the `draft` JSON column rather than in per-node rows:
it is generated, edited and accepted as one unit, and staging LLM output as a
JSON blob on an owning row is what Commit.analysis, GitRepo.summary,
ProjectMember.kpi and EvaluationSheet.axes already do.

Revision ID: 0022_task_breakdown
Revises: 0021_reference_files
Create Date: 2026-08-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022_task_breakdown"
down_revision: Union[str, None] = "0021_reference_files"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "task_breakdowns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sprint_id",
            sa.Integer(),
            sa.ForeignKey("sprints.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Set when breaking down an existing task rather than a document set.
        sa.Column(
            "parent_task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        # Plain id list, not a FK table: deleting a document later must not
        # invalidate the provenance of an already-accepted draft.
        sa.Column("reference_file_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("draft", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_task_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("task_breakdowns")
