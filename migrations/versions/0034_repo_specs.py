"""spec-kit folders synced from repositories

Specs can now also live in the repository, the spec-kit way:
specs/<feature>/{spec.md,plan.md,tasks.md}. A repo opts in (spec_sync_enabled,
off for every existing repo) and names the folder to read (spec_path).

On specs: plan.md is kept as text, tasks.md as its parsed lines plus which
tracker task each one matched (match only — nothing is created), and
missing_in_repo marks a folder that disappeared without deleting its history.

Revision ID: 0034_repo_specs
Revises: 0033_requirements
Create Date: 2026-10-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0034_repo_specs"
down_revision: Union[str, None] = "0033_requirements"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("git_repos", sa.Column("spec_sync_enabled", sa.Boolean(), nullable=False,
                                         server_default=sa.false()))
    op.add_column("git_repos", sa.Column("spec_path", sa.String(512), nullable=False,
                                         server_default="specs/"))
    op.add_column("git_repos", sa.Column("default_branch", sa.String(255)))
    op.add_column("git_repos", sa.Column("spec_sync_status", sa.String(16), nullable=False,
                                         server_default="none"))
    op.add_column("git_repos", sa.Column("spec_sync_error", sa.Text()))
    op.add_column("git_repos", sa.Column("spec_synced_at", sa.DateTime(timezone=True)))
    op.add_column("specs", sa.Column("plan_markdown", sa.Text()))
    op.add_column("specs", sa.Column("repo_tasks", sa.JSON()))
    op.add_column("specs", sa.Column("missing_in_repo", sa.Boolean(), nullable=False,
                                     server_default=sa.false()))


def downgrade() -> None:
    for col in ("missing_in_repo", "repo_tasks", "plan_markdown"):
        op.drop_column("specs", col)
    for col in ("spec_synced_at", "spec_sync_error", "spec_sync_status", "default_branch",
                "spec_path", "spec_sync_enabled"):
        op.drop_column("git_repos", col)
