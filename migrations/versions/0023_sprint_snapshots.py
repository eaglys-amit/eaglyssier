"""daily sprint snapshots for the burndown chart

A burndown needs what remained on each day, which current state cannot tell you —
so it has to be sampled. Rows are upserted by the daily scheduler job and also on
every burndown read, so an instance running with the scheduler off still builds
history.

`backfilled` marks a row reconstructed after the fact from resolved_at_src. That
reconstruction can't recover when a task entered or left the sprint, so those
series are approximate and the UI says so.

Revision ID: 0023_sprint_snapshots
Revises: 0022_task_breakdown
Create Date: 2026-08-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023_sprint_snapshots"
down_revision: Union[str, None] = "0022_task_breakdown"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sprint_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "sprint_id",
            sa.Integer(),
            sa.ForeignKey("sprints.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("total_points", sa.Float(), nullable=False, server_default="0"),
        sa.Column("remaining_points", sa.Float(), nullable=False, server_default="0"),
        sa.Column("completed_points", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_tasks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_tasks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("backfilled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        # One reading per sprint per day — the upsert key.
        sa.UniqueConstraint("sprint_id", "snapshot_date", name="uq_sprint_snapshot_day"),
    )


def downgrade() -> None:
    op.drop_table("sprint_snapshots")
