"""add projects.analysis_scope (persisted KPI/Evaluation data scope)

Revision ID: 0013_project_analysis_scope
Revises: 0012_evaluation_sheets
Create Date: 2026-07-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013_project_analysis_scope"
down_revision: Union[str, None] = "0012_evaluation_sheets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("analysis_scope", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "analysis_scope")
