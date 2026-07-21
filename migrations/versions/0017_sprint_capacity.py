"""sprint capacity: working days + per-member focus factor

Adds an optional working-days override to sprints and a
sprint_member_capacity table holding each member's focus factor (0.1-1.0)
per sprint. Allocated story points = focus_factor * working days.

Revision ID: 0017_sprint_capacity
Revises: 0016_project_scale
Create Date: 2026-07-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017_sprint_capacity"
down_revision: Union[str, None] = "0016_project_scale"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sprints", sa.Column("working_days", sa.Integer, nullable=True))
    op.create_table(
        "sprint_member_capacity",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("sprint_id", sa.Integer,
                  sa.ForeignKey("sprints.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_id", sa.Integer,
                  sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("focus_factor", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("sprint_id", "member_id", name="uq_sprint_member_capacity"),
    )


def downgrade() -> None:
    op.drop_table("sprint_member_capacity")
    op.drop_column("sprints", "working_days")
