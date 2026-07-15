"""add commit analysis columns + projects.analysis_provider

Revision ID: 0006_commit_analysis
Revises: 0005_project_scoped_members
Create Date: 2026-07-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_commit_analysis"
down_revision: Union[str, None] = "0005_project_scoped_members"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "analysis_provider",
            sa.String(length=32),
            nullable=False,
            server_default="claude_cli",
        ),
    )
    op.add_column(
        "commits",
        sa.Column(
            "analysis_status",
            sa.String(length=16),
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column("commits", sa.Column("analysis", sa.JSON(), nullable=True))
    op.add_column("commits", sa.Column("analysis_error", sa.Text(), nullable=True))
    op.add_column("commits", sa.Column("analysis_model", sa.String(length=128), nullable=True))
    op.add_column(
        "commits", sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("commits", "analyzed_at")
    op.drop_column("commits", "analysis_model")
    op.drop_column("commits", "analysis_error")
    op.drop_column("commits", "analysis")
    op.drop_column("commits", "analysis_status")
    op.drop_column("projects", "analysis_provider")
