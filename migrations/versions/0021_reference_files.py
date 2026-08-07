"""uploaded reference documents (md/txt/html/pdf)

Bytes live in RustFS under references/{project_id}/{id}/{filename}; the row keeps
the metadata plus the plain text extracted at upload time, which is what the AI
breakdown reads. Text is stored rather than re-extracted on demand so a prompt
never waits on object storage or a PDF parse.

Revision ID: 0021_reference_files
Revises: 0020_planning_poker
Create Date: 2026-08-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_reference_files"
down_revision: Union[str, None] = "0020_planning_poker"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reference_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # SET NULL: a spec usually outlives the ticket that first referenced it.
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("char_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extract_status", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("extract_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_reference_files_project_id", "reference_files", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_reference_files_project_id", table_name="reference_files")
    op.drop_table("reference_files")
