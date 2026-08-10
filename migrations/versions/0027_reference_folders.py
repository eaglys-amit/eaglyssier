"""folders for reference documents

The Documents tab was a flat list, which stops scaling the moment a project has
more than a screenful of specs. This adds the tree: an adjacency list keyed on
reference_folders.parent_id, mirroring tasks.parent_id rather than introducing a
second way to model hierarchy.

Two different delete rules, on purpose:

  reference_folders.parent_id  ON DELETE CASCADE
      Deleting a folder takes its subfolders. Orphaned child folders reparented
      to the root would be worse than nothing — the structure is the point.

  reference_files.folder_id    ON DELETE SET NULL
      The documents survive at the project root. Filing is organizational, and
      the blob in RustFS is the only copy — tidying up must never destroy it.
      Consistent with task_id on the same table, and with tasks.milestone_id.

folder_id is nullable with no default, so every document that predates this
migration reads as "at the root" with no backfill.

Sibling name uniqueness is enforced in app.services.references, not here:
Postgres treats NULLs as distinct, so a UNIQUE (project_id, parent_id, name)
would not apply to top-level folders — exactly where duplicates are most likely.

Revision ID: 0027_reference_folders
Revises: 0026_milestones
Create Date: 2026-08-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027_reference_folders"
down_revision: Union[str, None] = "0026_milestones"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reference_folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # NULL = top level. CASCADE: deleting a folder takes its subfolders.
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("reference_folders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_reference_folder_project_id", "reference_folders", ["project_id"])
    op.create_index("ix_reference_folder_parent_id", "reference_folders", ["parent_id"])

    # SET NULL: the document outlives the folder it was filed in. Named
    # constraint, added separately, so downgrade can drop it — the 0026 pattern.
    op.add_column("reference_files", sa.Column("folder_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_reference_file_folder_id",
        "reference_files",
        "reference_folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_reference_files_folder_id", "reference_files", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_reference_files_folder_id", table_name="reference_files")
    op.drop_constraint("fk_reference_file_folder_id", "reference_files", type_="foreignkey")
    op.drop_column("reference_files", "folder_id")
    op.drop_index("ix_reference_folder_parent_id", table_name="reference_folders")
    op.drop_index("ix_reference_folder_project_id", table_name="reference_folders")
    op.drop_table("reference_folders")
