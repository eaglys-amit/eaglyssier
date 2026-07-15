"""add per-repo git sync state to git_repos

Revision ID: 0011_repo_sync_state
Revises: 0010_deliverables_gen
Create Date: 2026-07-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_repo_sync_state"
down_revision: Union[str, None] = "0010_deliverables_gen"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "git_repos",
        sa.Column("sync_status", sa.String(length=16), nullable=False, server_default="idle"),
    )
    op.add_column("git_repos", sa.Column("sync_error", sa.Text(), nullable=True))
    op.add_column("git_repos", sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("git_repos", "synced_at")
    op.drop_column("git_repos", "sync_error")
    op.drop_column("git_repos", "sync_status")
