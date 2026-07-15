"""Alembic environment. Uses app settings for the URL and app models' metadata."""
from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from alembic.script import ScriptDirectory
from sqlalchemy import engine_from_config, inspect, pool

from app.config import settings
from app.models import Base  # noqa: F401  (imports all models -> populates metadata)

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _is_fresh_database(connection) -> bool:
    """True when neither alembic's version table nor any app table exists."""
    inspector = inspect(connection)
    return not inspector.has_table("alembic_version") and not inspector.has_table("projects")


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, compare_type=True
        )
        if _is_fresh_database(connection):
            # Fresh database: create the current schema directly from the models
            # and stamp head. Incremental migrations must not run here — the
            # bootstrap already produces the final schema, so replaying 0002+
            # would fail (e.g. adding columns that already exist).
            with context.begin_transaction():
                Base.metadata.create_all(bind=connection)
                script = ScriptDirectory.from_config(config)
                context.get_context().stamp(script, "head")
            return
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
