"""Planning-poker API schemas.

The load-bearing detail: :class:`PokerVoteOut` carries no real value for
``points``/``abstain`` while a round is still ``voting``. Redaction happens on
the server, not in the UI — the frontend polls this payload every 2 seconds and
anyone can read it with curl.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ApiModel


class PokerSessionCreateIn(BaseModel):
    name: str | None = None
    sprint_id: int | None = None
    # Tasks to queue. Empty = every unestimated leaf task in the sprint.
    task_ids: list[int] = []


class PokerVoteIn(BaseModel):
    member_id: int
    # None with abstain=True is the "?" card. None with abstain=False clears.
    points: float | None = None
    abstain: bool = False


class PokerRoundCreateIn(BaseModel):
    task_id: int


class PokerApplyIn(BaseModel):
    points: float
    note: str | None = None


class PokerVoteOut(BaseModel):
    """A cast vote. `points`/`abstain` stay empty until the round is revealed."""
    member_id: int
    display_name: str
    voted_at: datetime | None = None
    points: float | None = None
    abstain: bool | None = None


class PokerParticipantOut(BaseModel):
    """A project member who could vote, and whether they have."""
    member_id: int
    display_name: str
    has_voted: bool = False
    # True for someone who voted but is no longer on the project — their card
    # still counts for this round rather than vanishing mid-session.
    off_project: bool = False


class PokerStatsOut(BaseModel):
    """Spread across the revealed votes. Null before the reveal."""
    votes: int
    abstains: int
    low: float | None = None
    high: float | None = None
    median: float | None = None
    # True when every non-abstaining vote is the same value.
    consensus: bool = False
    # The scale value the spread suggests, rounded up to a real card.
    suggested: float | None = None


class PokerRoundOut(ApiModel):
    id: int
    session_id: int
    task_id: int
    task_key: str | None = None
    task_title: str = ""
    attempt: int
    status: str  # voting | revealed | applied | skipped
    final_points: float | None
    note: str | None
    revealed_at: datetime | None
    applied_at: datetime | None
    votes: list[PokerVoteOut] = []
    stats: PokerStatsOut | None = None


class PokerQueueItemOut(BaseModel):
    """A task waiting to be (or already) estimated in this session."""
    task_id: int
    task_key: str | None
    task_title: str
    story_points: float | None
    # The most recent round for this task, if any.
    round_status: str | None = None
    attempts: int = 0


class PokerSessionOut(ApiModel):
    id: int
    project_id: int
    sprint_id: int | None
    sprint_name: str | None = None
    name: str
    status: str  # open | closed
    deck: list[float] = []
    breakdown_points: list[float] = []
    created_at: datetime | None = None
    closed_at: datetime | None = None
    # Rollup for the session list.
    queued: int = 0
    estimated: int = 0


class PokerSessionDetail(PokerSessionOut):
    """The 2s poll target: session + current round + queue in one payload.

    One object so the UI can never render a half-updated session — a reveal
    flips `status` and un-redacts every vote in the same response.
    """
    participants: list[PokerParticipantOut] = []
    current_round: PokerRoundOut | None = None
    queue: list[PokerQueueItemOut] = []


class PokerApplyOut(BaseModel):
    round: PokerRoundOut
    task_id: int
    story_points: float
    # Advisory scale warnings (off-deck, needs-breakdown with no subtasks).
    warnings: list[str] = []
