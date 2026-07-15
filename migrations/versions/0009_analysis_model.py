"""add projects.analysis_model

Revision ID: 0009_analysis_model
Revises: 0008_member_kpi
Create Date: 2026-07-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_analysis_model"
down_revision: Union[str, None] = "0008_member_kpi"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("analysis_model", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "analysis_model")
