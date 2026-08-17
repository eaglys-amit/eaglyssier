"""hand-orderable poker queue

The queue's order was an accident of insertion: `_latest_rounds` sorted by round
id and `build_detail` votes on the first unsettled one, so the room estimated in
whatever order the session happened to queue things. There was no way to pull a
small task forward or push a blocked one back without closing the session.

`rank` makes that order explicit and movable. It is shared by every attempt of a
task, so a re-vote keeps the slot the queue was dragged to rather than jumping to
the end.

The backfill reproduces the previous ordering exactly — rows are ranked by the
*first* round id per task, which is what "first-seen task order" meant — and
spaces them by 1000 so the first drag has room to insert without a renumber.

Revision ID: 0028_poker_queue_rank
Revises: 0027_reference_folders
Create Date: 2026-08-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028_poker_queue_rank"
down_revision: Union[str, None] = "0027_reference_folders"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "poker_rounds",
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
    )
    # Rank by first-seen task order, spaced by RANK_STEP. Grouped by task so
    # every attempt shares one rank, which is what keeps a re-vote in place.
    op.execute(
        """
        UPDATE poker_rounds pr
        SET rank = sub.rk
        FROM (
            SELECT session_id,
                   task_id,
                   row_number() OVER (
                       PARTITION BY session_id ORDER BY MIN(id)
                   ) * 1000 AS rk
            FROM poker_rounds
            GROUP BY session_id, task_id
        ) AS sub
        WHERE pr.session_id = sub.session_id
          AND pr.task_id = sub.task_id
        """
    )
    op.create_index("ix_poker_rounds_session_rank", "poker_rounds", ["session_id", "rank"])


def downgrade() -> None:
    op.drop_index("ix_poker_rounds_session_rank", table_name="poker_rounds")
    op.drop_column("poker_rounds", "rank")
