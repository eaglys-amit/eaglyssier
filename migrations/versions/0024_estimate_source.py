"""record where a task's story points came from

An AI breakdown proposes estimates, and accepting one writes them straight onto
the task — at which point they are indistinguishable from a number the team
agreed. Planning poker then skips those tasks as "already estimated", so the
proposal never gets challenged.

`estimate_source` makes proposed a real state: 'ai' until a poker round or a
person settles it, then 'poker'/'manual'. NULL means a connector supplied it.

Revision ID: 0024_estimate_source
Revises: 0023_sprint_snapshots
Create Date: 2026-08-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024_estimate_source"
down_revision: Union[str, None] = "0023_sprint_snapshots"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("estimate_source", sa.String(length=16), nullable=True))
    # Existing local estimates were typed by a person or came from an accepted
    # breakdown; there is no way to tell them apart after the fact, and calling
    # them all 'ai' would put settled work back on the poker table. Leaving them
    # NULL means "unknown provenance", which is the honest answer.


def downgrade() -> None:
    op.drop_column("tasks", "estimate_source")
