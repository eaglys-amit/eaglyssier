"""Migration hygiene checks that don't need a database."""
from __future__ import annotations

import re
from pathlib import Path

VERSIONS = Path(__file__).resolve().parent.parent / "migrations" / "versions"


def test_revision_ids_fit_alembic_version_column():
    # alembic_version.version_num is VARCHAR(32); a longer id fails at upgrade time.
    for path in VERSIONS.glob("*.py"):
        match = re.search(r'^revision: str = "([^"]+)"', path.read_text(), re.M)
        assert match, path.name
        assert len(match.group(1)) <= 32, f"{path.name}: {match.group(1)!r} is over 32 chars"
