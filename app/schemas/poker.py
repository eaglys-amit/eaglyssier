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
    # Explicit queue. Empty = derive it from the scope below.
    task_ids: list[int] = []
    # Scope when task_ids is empty. The backlog alone by default — estimating
    # happens before planning. Set true to also pull in unestimated tasks that
    # are already in a sprint but still To Do (the carried-over ones).
    include_sprint_tasks: bool = False
    # Also re-estimate tasks whose points an AI breakdown proposed but the team
    # never agreed. They look estimated, so nothing else would surface them.
    include_proposed: bool = False
    # Also queue epic-typed tasks with no subtasks. Off because an epic is
    # structure — the Epics view owns it — but one nobody has broken down yet is
    # a work item, and it's the only kind of epic whose points a rollup counts.
    include_epics: bool = False
    # Whoever starts the session facilitates it: only they may reveal.
    facilitator_member_id: int | None = None


class PokerCandidateOut(BaseModel):
    task_id: int
    task_key: str | None
    title: str
    # None = in the backlog.
    sprint_id: int | None
    sprint_name: str | None
    # The number already on the task, when it's an unagreed AI proposal.
    proposed_points: float | None = None


class PokerCandidatesOut(BaseModel):
    """What a session would queue, so the count is visible before committing."""
    backlog: list[PokerCandidateOut] = []
    # Unestimated but already in a sprint and still To Do.
    in_sprints: list[PokerCandidateOut] = []
    # Have points, but only because an AI breakdown proposed them.
    proposed: list[PokerCandidateOut] = []
    # Epic-typed and childless. Behind their own checkbox, so they are counted
    # apart from the buckets the other boxes control.
    epics: list[PokerCandidateOut] = []


class PokerVoteIn(BaseModel):
    member_id: int
    # None with abstain=True is the "?" card. None with abstain=False clears.
    points: float | None = None
    abstain: bool = False


class PokerRoundCreateIn(BaseModel):
    task_id: int


class PokerRevealIn(BaseModel):
    """Who is revealing. Checked against the session's facilitator."""
    member_id: int | None = None


class PokerFacilitatorIn(BaseModel):
    member_id: int


class PokerSelectIn(BaseModel):
    """Put a queued task on the table (or clear it with `task_id: null`)."""
    task_id: int | None = None
    # Checked against the facilitator: this is what the whole room then votes on.
    member_id: int | None = None


class PokerQueueMoveIn(BaseModel):
    """Reposition a task in the session's queue.

    Positional, never a rank value — the server owns the numbers, the same
    contract the board's `after_task_id` uses. `after_task_id: null` means
    "put it first", which also makes it the round the room votes on next.
    """
    task_id: int
    after_task_id: int | None = None
    # Checked against the facilitator: queue order decides the current round.
    member_id: int | None = None


class PokerApplyIn(BaseModel):
    points: float
    note: str | None = None
    # Who is recording the estimate. Checked against the session's facilitator,
    # the same way the reveal is: the room discusses, one person writes it down.
    member_id: int | None = None


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
    # The context an engineer needs to put a number on it. A title alone is not
    # something anyone can estimate against.
    task_description: str | None = None
    task_acceptance_criteria: str | None = None
    task_issue_type: str | None = None
    attempt: int
    status: str  # voting | revealed | applied | skipped
    final_points: float | None
    note: str | None
    revealed_at: datetime | None
    applied_at: datetime | None
    votes: list[PokerVoteOut] = []
    stats: PokerStatsOut | None = None
    # What an AI breakdown had proposed, if anything. Withheld until the reveal
    # for the same reason the votes are: seeing the model's number first would
    # anchor the room, which is precisely what hidden voting exists to prevent.
    proposed_points: float | None = None


class PokerQueueItemOut(BaseModel):
    """A task waiting to be (or already) estimated in this session."""
    task_id: int
    task_key: str | None
    task_title: str
    # One line of context per row, so the queue is scannable without opening
    # each task.
    task_description: str | None = None
    story_points: float | None
    # The epic this task sits under — the root of its breakdown tree. None for
    # standalone work. Lets a refinement session filter down to one epic at a
    # time, which is how a room actually works through a backlog.
    epic_task_id: int | None = None
    epic_key: str | None = None
    epic_title: str | None = None
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
    facilitator_member_id: int | None = None
    facilitator_name: str | None = None
    deck: list[float] = []
    breakdown_points: list[float] = []
    # The task on the table. None = nothing selected yet; the room is between
    # estimates and waiting for the facilitator to choose.
    active_task_id: int | None = None
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
