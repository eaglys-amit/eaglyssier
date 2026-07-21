"""per-project story-point scale

Moves the story-point reference scale from org-wide (unique on points) to
per-project (unique on project_id + points). Existing global rows are deleted;
each project re-seeds its defaults lazily on first GET (the scale isn't consumed
in any calculation, so this is safe).

Revision ID: 0016_project_story_point_scale
Revises: 0015_member_scope
Create Date: 2026-07-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_project_scale"
down_revision: Union[str, None] = "0015_member_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. drop the org-wide unique on points (Postgres default constraint name)
    op.drop_constraint("story_point_scale_points_key", "story_point_scale", type_="unique")
    # 2. add project_id (nullable while we clear existing global rows)
    op.add_column("story_point_scale", sa.Column("project_id", sa.Integer, nullable=True))
    op.create_foreign_key(
        "story_point_scale_project_id_fkey", "story_point_scale", "projects",
        ["project_id"], ["id"], ondelete="CASCADE",
    )
    # 3. drop existing global rows (re-seeded per project on first GET)
    op.execute("DELETE FROM story_point_scale")
    # 4. now that the table is empty, project_id can be NOT NULL + composite unique
    op.alter_column("story_point_scale", "project_id", nullable=False)
    op.create_unique_constraint(
        "uq_scale_project_points", "story_point_scale", ["project_id", "points"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_scale_project_points", "story_point_scale", type_="unique")
    op.drop_constraint(
        "story_point_scale_project_id_fkey", "story_point_scale", type_="foreignkey"
    )
    op.drop_column("story_point_scale", "project_id")
    op.create_unique_constraint(
        "story_point_scale_points_key", "story_point_scale", ["points"]
    )
