"""add LLM commit->task attribution columns

Revision ID: 0018_commit_task_link
Revises: 0017_sprint_capacity
Create Date: 2026-07-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018_commit_task_link"
down_revision: Union[str, None] = "0017_sprint_capacity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("commits", sa.Column("linked_task_id", sa.Integer(), nullable=True))
    op.add_column(
        "commits",
        sa.Column(
            "link_status", sa.String(length=16), nullable=False, server_default="none"
        ),
    )
    op.add_column("commits", sa.Column("link_error", sa.Text(), nullable=True))
    op.add_column("commits", sa.Column("link_reason", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_commit_linked_task",
        "commits",
        "tasks",
        ["linked_task_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_commit_linked_task", "commits", type_="foreignkey")
    op.drop_column("commits", "link_reason")
    op.drop_column("commits", "link_error")
    op.drop_column("commits", "link_status")
    op.drop_column("commits", "linked_task_id")
