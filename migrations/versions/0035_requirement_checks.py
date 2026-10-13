"""AI check of a requirement's acceptance criteria

Verification is a person ticking each acceptance criterion (stored inside
requirements.acceptance_criteria already). These columns hold the optional AI
check that suggests, per criterion, whether the linked tasks and commits show
it delivered — met / partial / not evident, with the evidence cited — so the
person ticking has something to go on. Empty until someone runs a check.

Revision ID: 0035_requirement_checks
Revises: 0034_repo_specs
Create Date: 2026-10-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0035_requirement_checks"
down_revision: Union[str, None] = "0034_repo_specs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requirements", sa.Column("ai_check", sa.JSON()))
    op.add_column("requirements", sa.Column("ai_check_status", sa.String(16), nullable=False,
                                            server_default="none"))
    op.add_column("requirements", sa.Column("ai_check_error", sa.Text()))


def downgrade() -> None:
    for col in ("ai_check_error", "ai_check_status", "ai_check"):
        op.drop_column("requirements", col)
