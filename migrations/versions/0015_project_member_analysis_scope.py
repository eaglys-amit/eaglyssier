"""add project_members.analysis_scope (per-member data selection)

Moves the analysis data selection from the project (0013) to each project
member, so KPI/Evaluation generation scopes to the member's own saved
sprints/repos/date range. The old projects.analysis_scope column is left in
place but no longer read.

Revision ID: 0015_project_member_analysis_scope
Revises: 0014_commit_is_merge
Create Date: 2026-07-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015_member_scope"
down_revision: Union[str, None] = "0014_commit_is_merge"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_members", sa.Column("analysis_scope", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("project_members", "analysis_scope")
