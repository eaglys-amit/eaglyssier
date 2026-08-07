"""planning poker sessions, rounds and votes

Estimation happens as a round per task: everyone picks a card, the values stay
hidden server-side until someone reveals, and the agreed number is written back
to Task.story_points. `attempt` on a round lets the team re-vote after a
discussion without losing the first pass.

Revision ID: 0020_planning_poker
Revises: 0019_scrum_local
Create Date: 2026-08-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020_planning_poker"
down_revision: Union[str, None] = "0019_scrum_local"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "poker_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # SET NULL: a session may outlive the sprint it was planning for.
        sa.Column(
            "sprint_id",
            sa.Integer(),
            sa.ForeignKey("sprints.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        # Deck snapshotted from the project's scale at creation, so editing the
        # scale mid-session can't change the cards under the players.
        sa.Column("deck", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("breakdown_points", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "poker_rounds",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("poker_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="voting"),
        sa.Column("final_points", sa.Float(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("revealed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "session_id", "task_id", "attempt", name="uq_poker_round_task_attempt"
        ),
    )

    op.create_table(
        "poker_votes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "round_id",
            sa.Integer(),
            sa.ForeignKey("poker_rounds.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "member_id",
            sa.Integer(),
            sa.ForeignKey("members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("points", sa.Float(), nullable=True),
        sa.Column("abstain", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        # One card per member per round: re-voting replaces it.
        sa.UniqueConstraint("round_id", "member_id", name="uq_poker_vote_round_member"),
    )


def downgrade() -> None:
    op.drop_table("poker_votes")
    op.drop_table("poker_rounds")
    op.drop_table("poker_sessions")
