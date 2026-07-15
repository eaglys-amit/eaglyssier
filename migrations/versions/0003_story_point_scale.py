"""add story_point_scale

Revision ID: 0003_story_point_scale
Revises: 0002_task_description
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_story_point_scale"
down_revision: Union[str, None] = "0002_task_description"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "story_point_scale",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("points", sa.Integer(), nullable=False, unique=True),
        sa.Column("min_hours", sa.Float(), nullable=True),
        sa.Column("max_hours", sa.Float(), nullable=True),
        sa.Column("risk", sa.String(length=32), nullable=False, server_default="None"),
        sa.Column("needs_breakdown", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("story_point_scale")
