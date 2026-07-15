"""initial schema

Creates all tables from the SQLAlchemy metadata. Because this reads the *live*
models, it always produces the current (head) schema, not the schema as of this
revision — so fresh databases must never replay 0002+ after it. env.py handles
this: an empty database is bootstrapped via create_all and stamped to head,
skipping the migration chain entirely; this revision only remains as the root
of the chain for databases that already exist.

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-06
"""
from typing import Sequence, Union

from alembic import op

from app.models import Base

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
