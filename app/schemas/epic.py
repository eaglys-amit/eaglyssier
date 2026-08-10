"""Epic generation: group flat tracker tasks into containers by their own naming.

The grouping is read out of the task titles, not invented. Teams that number
work (``PBR9-PBI2-ST1: …``) have already stated the hierarchy; the tracker just
never carried it across. See app.services.epics.
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.schemas.common import ApiModel


class EpicMemberRef(ApiModel):
    """One task a proposed epic would take in, and whether it can."""
    task_id: int
    key: str
    title: str
    story_points: float | None = None
    sprint_name: str | None = None
    source: str = "sync"
    # group | skip
    action: str = "group"
    # Why it can't be taken in, when action is 'skip'.
    reason: str | None = None


class EpicProposal(ApiModel):
    # The parsed token this group is keyed on, e.g. 'PBR9' or 'PBI1'.
    group_key: str
    name: str
    # 'pbr' (a refinement/release round) or 'pbi' (an early backlog item).
    kind: str
    members: list[EpicMemberRef] = []
    member_count: int = 0
    skip_count: int = 0
    total_points: float = 0.0
    # From the sprints its members sit in — context for the roadmap later.
    sprint_names: list[str] = []
    start_date: date | None = None
    end_date: date | None = None
    # create = a new epic; top_up = add members to the epic a previous run made.
    mode: str = "create"
    existing_task_id: int | None = None
    conflict: str | None = None


class EpicPreviewOut(BaseModel):
    proposals: list[EpicProposal] = []
    ready_count: int = 0
    create_count: int = 0
    top_up_count: int = 0
    total_member_count: int = 0
    # Tasks that need a group but whose titles carry no recognisable token.
    # Surfaced rather than hidden: silent partial coverage is what made the
    # milestone generator look broken.
    ungrouped: list[EpicMemberRef] = []
    # Every task with no parent and no children — the denominator for coverage.
    needs_group_count: int = 0
    coverage_pct: float = 0.0


class EpicGenerateIn(BaseModel):
    """Which proposals to apply, by group_key. None (omitted) = every ready one."""
    group_keys: list[str] | None = None
    # group_key -> the name the user settled on, whether typed or accepted from
    # a suggestion. Overrides the derived label.
    names: dict[str, str] | None = None


class EpicNamesOut(BaseModel):
    """Suggested names, keyed by group_key. Advisory — the user can edit each one."""
    names: dict[str, str] = {}
    model: str | None = None


class NameableGroup(ApiModel):
    """A group that can be named: either not yet applied, or an existing epic."""
    group_key: str
    current_name: str
    member_count: int
    # Set when an epic already exists for this key — a rename rather than a create.
    existing_task_id: int | None = None


class EpicNameablesOut(BaseModel):
    groups: list[NameableGroup] = []


class EpicRenameIn(BaseModel):
    """group_key -> new title, for epics a previous run already created."""
    names: dict[str, str] = {}


class EpicRenameOut(BaseModel):
    renamed: int = 0


class EpicGenerateOut(BaseModel):
    created: int = 0
    updated: int = 0
    grouped: int = 0
    skipped: int = 0
    # The epic tasks created or extended, so the client can link straight to them.
    epic_task_ids: list[int] = []


class EpicUngroupOut(BaseModel):
    """Undo: children released, container removed."""
    released: int = 0
    deleted: bool = False
