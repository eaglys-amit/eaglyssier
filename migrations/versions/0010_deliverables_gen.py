"""add deliverables-generation state + Deliverable.source

Revision ID: 0010_deliverables_gen
Revises: 0009_analysis_model
Create Date: 2026-07-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_deliverables_gen"
down_revision: Union[str, None] = "0009_analysis_model"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("deliverables_status", sa.String(length=16), nullable=False, server_default="none"),
    )
    op.add_column("projects", sa.Column("deliverables_error", sa.Text(), nullable=True))
    op.add_column("projects", sa.Column("deliverables_model", sa.String(length=128), nullable=True))
    op.add_column(
        "projects",
        sa.Column("deliverables_generated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "deliverables",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
    )


def downgrade() -> None:
    op.drop_column("deliverables", "source")
    op.drop_column("projects", "deliverables_generated_at")
    op.drop_column("projects", "deliverables_model")
    op.drop_column("projects", "deliverables_error")
    op.drop_column("projects", "deliverables_status")
