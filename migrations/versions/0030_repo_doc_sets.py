"""per-repository AI documentation sets

Each repository gets a folder tree of markdown documents — PRD, API spec,
roadmap, dependency/license review, test plan, security assessment, CI/CD
runbook, release notes — written by the analysis provider and stored in RustFS.

The two tables mirror reference_folders/reference_files, including the split in
delete rules documented there:

  repo_doc_folders.parent_id  ON DELETE CASCADE
  repo_docs.folder_id         ON DELETE SET NULL

Deleting a folder takes its subfolders, because an empty shell of child folders
is worse than nothing. But the documents themselves survive at the set root: the
RustFS blob is the only copy, so tidying up folders must never destroy bytes.
Re-filing a document is a nuisance; losing a generated one is unrecoverable.

`template_key`, not `name`, is the seeding anchor. Renaming
`01_Requirements_&_Design` must not make the next seed create a second copy of
it, so the stable slug carries the identity and the name stays free text. Its
UNIQUE is safe alongside manual and AI-suggested rows because Postgres treats
NULLs as distinct.

Sibling-name uniqueness is deliberately NOT a constraint here. Every top-level
folder has `parent_id IS NULL` and Postgres treats those NULLs as distinct, so
`UNIQUE (repo_id, parent_id, name)` would silently not apply exactly where
duplicates are most likely. app.services.repo_docs enforces it case-insensitively
instead, which is also what lets it return a 409 naming the clash.

`rank` is folder-scoped on folders but repo-scoped on documents: the drain
worker orders the generation queue by (repo_id, rank, id) with no join to
folders, so moving a document between folders needs no re-rank.

`repo_docs.storage_key` is NULLABLE where `reference_files.storage_key` is not.
A reference file is created by an upload and always has bytes; the template here
seeds eleven documents *before* any of them is generated, so a row legitimately
exists with nothing behind it.

The columns on git_repos hold the model's proposal for extra folders/documents
fitting that repo. Columns rather than a table of their own, for the reason the
summary_* quintet beside them is shaped that way: only one proposal is ever
meaningful at a time, and its history has no value once accepted or dismissed.

Revision ID: 0030_repo_doc_sets
Revises: 0029_poker_active_task
Create Date: 2026-09-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0030_repo_doc_sets"
down_revision: Union[str, None] = "0029_poker_active_task"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "repo_doc_folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "repo_id",
            sa.Integer(),
            sa.ForeignKey("git_repos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("repo_doc_folders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("template_key", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("repo_id", "template_key", name="uq_repo_doc_folder_template"),
    )
    op.create_index("ix_repo_doc_folder_repo_id", "repo_doc_folders", ["repo_id"])
    op.create_index("ix_repo_doc_folder_parent_id", "repo_doc_folders", ["parent_id"])

    op.create_table(
        "repo_docs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "repo_id",
            sa.Integer(),
            sa.ForeignKey("git_repos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "folder_id",
            sa.Integer(),
            sa.ForeignKey("repo_doc_folders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("template_key", sa.String(length=64), nullable=True),
        sa.Column("guidance", sa.Text(), nullable=True),
        sa.Column("context_kinds", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("reference_file_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("char_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("rev", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("repo_id", "template_key", name="uq_repo_doc_template"),
    )
    op.create_index("ix_repo_doc_repo_id", "repo_docs", ["repo_id"])
    op.create_index("ix_repo_doc_folder_id", "repo_docs", ["folder_id"])
    op.create_index("ix_repo_doc_repo_status", "repo_docs", ["repo_id", "status"])
    op.create_index("ix_repo_doc_repo_rank", "repo_docs", ["repo_id", "rank"])

    # NULL docs_seeded_at means "the template has never been seeded here", which
    # is exactly right for every existing repo.
    op.add_column("git_repos", sa.Column("docs_seeded_at", sa.DateTime(timezone=True)))
    op.add_column(
        "git_repos",
        sa.Column(
            "doc_suggest_status", sa.String(length=16), nullable=False, server_default="none"
        ),
    )
    op.add_column("git_repos", sa.Column("doc_suggestions", sa.JSON(), nullable=True))
    op.add_column("git_repos", sa.Column("doc_suggest_error", sa.Text(), nullable=True))
    op.add_column("git_repos", sa.Column("doc_suggest_model", sa.String(length=128)))
    op.add_column("git_repos", sa.Column("doc_suggested_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    for column in (
        "doc_suggested_at",
        "doc_suggest_model",
        "doc_suggest_error",
        "doc_suggestions",
        "doc_suggest_status",
        "docs_seeded_at",
    ):
        op.drop_column("git_repos", column)

    op.drop_index("ix_repo_doc_repo_rank", table_name="repo_docs")
    op.drop_index("ix_repo_doc_repo_status", table_name="repo_docs")
    op.drop_index("ix_repo_doc_folder_id", table_name="repo_docs")
    op.drop_index("ix_repo_doc_repo_id", table_name="repo_docs")
    op.drop_table("repo_docs")

    op.drop_index("ix_repo_doc_folder_parent_id", table_name="repo_doc_folders")
    op.drop_index("ix_repo_doc_folder_repo_id", table_name="repo_doc_folders")
    op.drop_table("repo_doc_folders")
