"""add project_members KPI columns

Revision ID: 0008_member_kpi
Revises: 0007_repo_summary
Create Date: 2026-07-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_member_kpi"
down_revision: Union[str, None] = "0007_repo_summary"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_members",
        sa.Column(
            "kpi_status", sa.String(length=16), nullable=False, server_default="none"
        ),
    )
    op.add_column("project_members", sa.Column("kpi", sa.JSON(), nullable=True))
    op.add_column("project_members", sa.Column("kpi_error", sa.Text(), nullable=True))
    op.add_column("project_members", sa.Column("kpi_model", sa.String(length=128), nullable=True))
    op.add_column(
        "project_members", sa.Column("kpi_generated_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("project_members", "kpi_generated_at")
    op.drop_column("project_members", "kpi_model")
    op.drop_column("project_members", "kpi_error")
    op.drop_column("project_members", "kpi")
    op.drop_column("project_members", "kpi_status")
