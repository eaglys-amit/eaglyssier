"""add commits.is_merge (PR merges / branch updates vs authored work)

Backfills existing rows from the auto-generated merge-message patterns; new
syncs set the flag from the commit's parent count.

Revision ID: 0014_commit_is_merge
Revises: 0013_project_analysis_scope
Create Date: 2026-07-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_commit_is_merge"
down_revision: Union[str, None] = "0013_project_analysis_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "commits",
        sa.Column("is_merge", sa.Boolean(), nullable=False, server_default="false"),
    )
    # Heuristic backfill for rows synced before the flag existed; a re-sync
    # replaces this with the exact parent-count answer.
    op.execute(
        "UPDATE commits SET is_merge = true WHERE "
        "message LIKE 'Merge pull request %' OR "
        "message LIKE 'Merge branch %' OR "
        "message LIKE 'Merge remote-tracking branch %'"
    )


def downgrade() -> None:
    op.drop_column("commits", "is_merge")
