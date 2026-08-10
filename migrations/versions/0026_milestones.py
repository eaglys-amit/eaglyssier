"""milestones and the task link that feeds the roadmap

Sprints answer "what are we doing for the next two weeks". Nothing answered
"when does v1.1 ship, and will it be late" — this adds the object that does.

A milestone deliberately stores no progress numbers. Everything the Roadmap and
List views show is derived on read from the tasks pointing at it: the
story-point rollup (leaves only, per app.services.tasks.leaf_only), the sprints
it spans (SELECT DISTINCT over those tasks), and the completion forecast (from
app.services.burndown.build_velocity). Storing any of it would mean a second
write on every board drag, and a roadmap that silently drifts from the board.

tasks.milestone_id is ON DELETE SET NULL, matching sprint_id and parent_id:
deleting a milestone releases its work rather than destroying it.

Revision ID: 0026_milestones
Revises: 0025_poker_facilitator
Create Date: 2026-08-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026_milestones"
down_revision: Union[str, None] = "0025_poker_facilitator"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "milestones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        # planned | in_progress | released | cancelled. Set by hand; the
        # derived on_track/at_risk/overdue health is computed on read.
        sa.Column(
            "state", sa.String(length=16), nullable=False, server_default="planned"
        ),
        sa.Column("released_date", sa.Date(), nullable=True),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_milestone_project_id", "milestones", ["project_id"])

    op.add_column("tasks", sa.Column("milestone_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_task_milestone_id",
        "tasks",
        "milestones",
        ["milestone_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_task_milestone_id", "tasks", ["milestone_id"])


def downgrade() -> None:
    op.drop_index("ix_task_milestone_id", table_name="tasks")
    op.drop_constraint("fk_task_milestone_id", "tasks", type_="foreignkey")
    op.drop_column("tasks", "milestone_id")
    op.drop_index("ix_milestone_project_id", table_name="milestones")
    op.drop_table("milestones")
