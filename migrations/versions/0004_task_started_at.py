"""add tasks.started_at_src

Revision ID: 0004_task_started_at
Revises: 0003_story_point_scale
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_task_started_at"
down_revision: Union[str, None] = "0003_story_point_scale"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("started_at_src", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "started_at_src")
