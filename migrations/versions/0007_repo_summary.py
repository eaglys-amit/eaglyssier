"""add git_repos summary columns

Revision ID: 0007_repo_summary
Revises: 0006_commit_analysis
Create Date: 2026-07-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_repo_summary"
down_revision: Union[str, None] = "0006_commit_analysis"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "git_repos",
        sa.Column(
            "summary_status",
            sa.String(length=16),
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column("git_repos", sa.Column("summary", sa.JSON(), nullable=True))
    op.add_column("git_repos", sa.Column("summary_error", sa.Text(), nullable=True))
    op.add_column("git_repos", sa.Column("summary_model", sa.String(length=128), nullable=True))
    op.add_column(
        "git_repos", sa.Column("summarized_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("git_repos", "summarized_at")
    op.drop_column("git_repos", "summary_model")
    op.drop_column("git_repos", "summary_error")
    op.drop_column("git_repos", "summary")
    op.drop_column("git_repos", "summary_status")
