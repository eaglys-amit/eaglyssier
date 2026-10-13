"""specs, their requirements, and which tasks implement them

Spec-driven tracking needs a unit smaller than a document: a requirement
(FR-001, "4.2", a user story) that work can be traced to and measured against.

- `specs`: one per tracked specification — an uploaded document now, a repo
  spec folder later — with a version counter and an extraction job.
- `spec_revisions`: the text of every applied version, so a revision can be
  compared with the one before.
- `requirements`: the numbered items, with acceptance criteria and how they
  changed in the latest version. Status is derived from linked tasks, never
  stored, so it can't drift from the board.
- `requirement_tasks`: many-to-many links, flagged for review when the
  requirement changes underneath them.

Nothing existing is touched; empty tables until someone creates a spec.

Revision ID: 0033_requirements
Revises: 0032_exec_report_schedule
Create Date: 2026-10-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0033_requirements"
down_revision: Union[str, None] = "0032_exec_report_schedule"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "specs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="document"),
        sa.Column("reference_file_id", sa.Integer(),
                  sa.ForeignKey("reference_files.id", ondelete="SET NULL")),
        sa.Column("repo_id", sa.Integer(), sa.ForeignKey("git_repos.id", ondelete="CASCADE")),
        sa.Column("path", sa.String(1024)),
        sa.Column("ref", sa.String(255)),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content_hash", sa.String(64)),
        sa.Column("extract_status", sa.String(16), nullable=False, server_default="none"),
        sa.Column("extract_error", sa.Text()),
        sa.Column("extract_model", sa.String(128)),
        sa.Column("pending_file_id", sa.Integer(),
                  sa.ForeignKey("reference_files.id", ondelete="SET NULL")),
        sa.Column("synced_at", sa.DateTime(timezone=True)),
        *_timestamps(),
    )
    op.create_index("ix_specs_project_id", "specs", ["project_id"])

    op.create_table(
        "spec_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("spec_id", sa.Integer(),
                  sa.ForeignKey("specs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("reference_file_id", sa.Integer(),
                  sa.ForeignKey("reference_files.id", ondelete="SET NULL")),
        sa.Column("changes", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("spec_id", "version", name="uq_spec_revision"),
    )

    op.create_table(
        "requirements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("spec_id", sa.Integer(),
                  sa.ForeignKey("specs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("key_origin", sa.String(16), nullable=False, server_default="generated"),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False, server_default="functional"),
        sa.Column("priority", sa.String(16)),
        sa.Column("acceptance_criteria", sa.JSON(), nullable=False),
        sa.Column("source_excerpt", sa.Text()),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("change_state", sa.String(16), nullable=False, server_default="unchanged"),
        sa.Column("changed_in_version", sa.Integer()),
        *_timestamps(),
        sa.UniqueConstraint("spec_id", "key", name="uq_requirement_key"),
    )
    op.create_index("ix_requirements_spec_id", "requirements", ["spec_id"])

    op.create_table(
        "requirement_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("requirement_id", sa.Integer(),
                  sa.ForeignKey("requirements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Integer(),
                  sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()),
        *_timestamps(),
        sa.UniqueConstraint("requirement_id", "task_id", name="uq_requirement_task"),
    )
    op.create_index("ix_requirement_tasks_task_id", "requirement_tasks", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_requirement_tasks_task_id", table_name="requirement_tasks")
    op.drop_table("requirement_tasks")
    op.drop_index("ix_requirements_spec_id", table_name="requirements")
    op.drop_table("requirements")
    op.drop_table("spec_revisions")
    op.drop_index("ix_specs_project_id", table_name="specs")
    op.drop_table("specs")
