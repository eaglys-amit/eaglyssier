"""the room picks what it estimates next

The current round used to be implicit: the first unsettled task in queue order.
Applying an estimate therefore pulled the next task onto the table by itself,
mid-conversation, whether or not anyone was ready for it.

`active_task_id` makes the choice explicit — the facilitator selects the task,
and NULL means nothing is on the table yet. That resting state is normal, not an
error: it's the gap between finishing one estimate and agreeing what's next.

Open sessions land on NULL, so an in-flight session shows its queue and waits to
be told what to estimate rather than silently resuming on some arbitrary row.

Revision ID: 0029_poker_active_task
Revises: 0028_poker_queue_rank
Create Date: 2026-08-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029_poker_active_task"
down_revision: Union[str, None] = "0028_poker_queue_rank"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "poker_sessions", sa.Column("active_task_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_poker_session_active_task",
        "poker_sessions",
        "tasks",
        ["active_task_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Carry over whatever each open session was already showing, so a session
    # that is mid-vote right now doesn't lose the task on its table when this
    # ships. Closed sessions have nothing in flight and stay NULL.
    op.execute(
        """
        UPDATE poker_sessions ps
        SET active_task_id = sub.task_id
        FROM (
            SELECT DISTINCT ON (r.session_id) r.session_id, r.task_id
            FROM poker_rounds r
            JOIN (
                SELECT session_id, task_id, MAX(attempt) AS attempt
                FROM poker_rounds GROUP BY session_id, task_id
            ) newest
              ON newest.session_id = r.session_id
             AND newest.task_id = r.task_id
             AND newest.attempt = r.attempt
            WHERE r.status IN ('voting', 'revealed')
            ORDER BY r.session_id, r.rank, r.id
        ) AS sub
        WHERE ps.id = sub.session_id
          AND ps.status = 'open'
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_poker_session_active_task", "poker_sessions", type_="foreignkey")
    op.drop_column("poker_sessions", "active_task_id")
