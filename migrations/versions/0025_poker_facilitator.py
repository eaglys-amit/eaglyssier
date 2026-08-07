"""only the session's starter may reveal the cards

Reveal was open to anyone, which meant a single early click could turn the
cards over before the room had finished thinking. The person who starts the
session now holds that control.

Advisory, like the votes themselves: this app has no auth, so the member id is
self-declared. It stops an accident, not a determined actor — and the UI offers
an explicit, attributed hand-over so a closed tab can't strand the room.

Revision ID: 0025_poker_facilitator
Revises: 0024_estimate_source
Create Date: 2026-08-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025_poker_facilitator"
down_revision: Union[str, None] = "0024_estimate_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "poker_sessions", sa.Column("facilitator_member_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_poker_session_facilitator",
        "poker_sessions",
        "members",
        ["facilitator_member_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Existing sessions keep NULL, which means "no facilitator" and therefore
    # open reveal — the behaviour they were created under.


def downgrade() -> None:
    op.drop_constraint("fk_poker_session_facilitator", "poker_sessions", type_="foreignkey")
    op.drop_column("poker_sessions", "facilitator_member_id")
