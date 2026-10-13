"""weekly executive report per project

The executive report is meant to land in leadership's lap every week without
anyone remembering to click Generate. A project opts in with this flag; the
scheduler's Monday job generates one covering the previous seven days.

Off for every existing project, so nothing starts calling the LLM provider
on its own until someone turns it on.

Revision ID: 0032_exec_report_schedule
Revises: 0031_auth_users_roles
Create Date: 2026-10-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0032_exec_report_schedule"
down_revision: Union[str, None] = "0031_auth_users_roles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("exec_report_weekly", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("projects", "exec_report_weekly")
