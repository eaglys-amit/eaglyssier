"""allow locally-created sprints and tasks (Scrums feature)

Sprints and tasks stop being connector-only. `source` discriminates rows a
connector owns ('sync') from rows created by hand in the Scrums tab ('local'),
and the external id columns become nullable because local rows have none.
Postgres treats NULLs as distinct in a UNIQUE constraint, so the existing
uq_sprint_project_external / uq_task_project_key keep deduplicating synced rows
while any number of local rows coexist — neither constraint needs changing.

Tasks also gain the breakdown parent link and the backlog board's manual
ordering. Existing rows are backfilled to source='sync' by the server_default.

Revision ID: 0019_scrum_local
Revises: 0018_commit_task_link
Create Date: 2026-08-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_scrum_local"
down_revision: Union[str, None] = "0018_commit_task_link"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- sprints ----------------------------------------------------------
    op.alter_column(
        "sprints", "external_id", existing_type=sa.String(length=64), nullable=True
    )
    op.add_column(
        "sprints",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="sync"),
    )
    op.add_column("sprints", sa.Column("committed_points", sa.Float(), nullable=True))

    # ---- tasks ------------------------------------------------------------
    op.alter_column(
        "tasks", "external_key", existing_type=sa.String(length=64), nullable=True
    )
    op.add_column(
        "tasks",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="sync"),
    )
    op.add_column("tasks", sa.Column("parent_id", sa.Integer(), nullable=True))
    op.add_column("tasks", sa.Column("priority", sa.String(length=16), nullable=True))
    op.add_column("tasks", sa.Column("acceptance_criteria", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_task_parent", "tasks", "tasks", ["parent_id"], ["id"], ondelete="SET NULL"
    )

    # rank: add nullable, seed a deterministic sparse order, then lock it down.
    # Seeding from the old list ordering (external_key) means a Jira-only
    # project's board looks exactly like the Data tab did before this change.
    op.add_column("tasks", sa.Column("rank", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE tasks t SET rank = r.rn * 1000
        FROM (
            SELECT id, row_number() OVER (
                PARTITION BY project_id
                ORDER BY sprint_id NULLS LAST, external_key, id
            ) AS rn
            FROM tasks
        ) r
        WHERE t.id = r.id
        """
    )
    op.alter_column(
        "tasks", "rank", existing_type=sa.Integer(), nullable=False, server_default="0"
    )

    op.create_index("ix_task_parent_id", "tasks", ["parent_id"])
    op.create_index(
        "ix_task_project_sprint_rank", "tasks", ["project_id", "sprint_id", "rank"]
    )

    # The `source` guards in sync.py and the tolerant deletes in
    # app/api/routes/data.py are the only thing standing between a Jira sync and
    # hand-planned work that no re-sync can rebuild. These turn the likeliest
    # mistake — creating a 'sync' row with no external id, or stripping the key
    # off one — into a loud IntegrityError instead of silent data loss.
    op.create_check_constraint(
        "ck_sprint_sync_has_external", "sprints", "source <> 'sync' OR external_id IS NOT NULL"
    )
    op.create_check_constraint(
        "ck_task_sync_has_key", "tasks", "source <> 'sync' OR external_key IS NOT NULL"
    )


def downgrade() -> None:
    # Note: the two alter_column calls back to NOT NULL fail if any local rows
    # exist. That is correct — there is no sane way to give a hand-created
    # sprint or task a connector id, so the operator must delete them first.
    op.drop_constraint("ck_task_sync_has_key", "tasks", type_="check")
    op.drop_constraint("ck_sprint_sync_has_external", "sprints", type_="check")

    op.drop_index("ix_task_project_sprint_rank", table_name="tasks")
    op.drop_index("ix_task_parent_id", table_name="tasks")
    op.drop_constraint("fk_task_parent", "tasks", type_="foreignkey")
    op.drop_column("tasks", "rank")
    op.drop_column("tasks", "acceptance_criteria")
    op.drop_column("tasks", "priority")
    op.drop_column("tasks", "parent_id")
    op.drop_column("tasks", "source")
    op.alter_column(
        "tasks", "external_key", existing_type=sa.String(length=64), nullable=False
    )

    op.drop_column("sprints", "committed_points")
    op.drop_column("sprints", "source")
    op.alter_column(
        "sprints", "external_id", existing_type=sa.String(length=64), nullable=False
    )
