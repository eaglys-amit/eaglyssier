"""Planning poker: rounds, hidden votes, reveal, and writing the estimate back.

Three rules shape this module:

**Votes are hidden server-side.** The frontend polls ``GET /poker/{id}`` every
two seconds, so while a round is still ``voting`` the payload carries who has
voted but never what they picked — :func:`round_out` simply doesn't copy the
values across. Hiding in the UI would be theatre: anyone can curl the endpoint.
(The keys still serialize as null; the client decides whether to render a value
from ``round.status``, never from the presence of the field.)

**Anyone can reveal, and revealing is idempotent.** There is no auth, so there
is no facilitator to gate it on; gating on the person who created the session
would deadlock the room the moment they closed their tab. Two simultaneous
reveals are therefore fine — the second is a no-op that returns the same round.

**Nothing auto-advances.** The ``voted / participants`` counter is advisory. An
auto-reveal at "everyone voted" would fire in the face of someone who joined a
millisecond after the last vote and hasn't read the task yet.
"""
from __future__ import annotations

import statistics
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Member,
    PokerRound,
    PokerSession,
    PokerVote,
    ProjectMember,
    Sprint,
    Task,
)
from app.schemas.poker import (
    PokerApplyIn,
    PokerApplyOut,
    PokerParticipantOut,
    PokerQueueItemOut,
    PokerRoundCreateIn,
    PokerRoundOut,
    PokerSessionCreateIn,
    PokerSessionDetail,
    PokerSessionOut,
    PokerStatsOut,
    PokerVoteIn,
    PokerVoteOut,
)
from app.services import scale as scale_svc
from app.services import tasks as tasks_svc


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ sessions


def get_session(db: Session, project_id: int, session_id: int) -> PokerSession:
    session = db.get(PokerSession, session_id)
    if session is None or session.project_id != project_id:
        raise HTTPException(404, "Poker session not found")
    return session


def create_session(
    db: Session, project_id: int, data: PokerSessionCreateIn
) -> PokerSession:
    """Open a session, snapshotting the deck from the project's scale."""
    deck = scale_svc.build_deck(db, project_id)
    if not deck.points:
        raise HTTPException(
            409,
            "This project has no story-point scale, so there are no cards to deal. "
            "Set one on the Capacity tab first.",
        )

    sprint: Sprint | None = None
    if data.sprint_id is not None:
        sprint = db.get(Sprint, data.sprint_id)
        if sprint is None or sprint.project_id != project_id:
            raise HTTPException(404, "Sprint not found")

    task_ids = data.task_ids or _unestimated_task_ids(db, project_id, data.sprint_id)
    if not task_ids:
        raise HTTPException(
            409,
            "Nothing to estimate — every task here already has story points.",
        )
    # Reject foreign ids up front rather than opening a session with a broken queue.
    valid = set(
        db.execute(
            select(Task.id).where(Task.project_id == project_id, Task.id.in_(task_ids))
        ).scalars().all()
    )
    ordered = [tid for tid in task_ids if tid in valid]
    if not ordered:
        raise HTTPException(404, "None of those tasks are in this project")

    session = PokerSession(
        project_id=project_id,
        sprint_id=data.sprint_id,
        name=(data.name or "").strip() or _default_name(sprint),
        status="open",
        deck=[float(p) for p in deck.points],
        breakdown_points=[float(p) for p in deck.needs_breakdown],
    )
    db.add(session)
    db.flush()

    # One round per queued task, created up front so the queue survives a
    # reload and the order the team agreed on is the order they get.
    for task_id in ordered:
        db.add(PokerRound(session_id=session.id, task_id=task_id, attempt=1, status="voting"))
    db.commit()
    db.refresh(session)
    return session


def _default_name(sprint: Sprint | None) -> str:
    return f"{sprint.name} estimation" if sprint else "Backlog estimation"


def _unestimated_task_ids(
    db: Session, project_id: int, sprint_id: int | None
) -> list[int]:
    """Leaf tasks with no estimate, newest-ranked last.

    Leaves only: a container's points roll up from its children, so putting an
    epic on the table would ask the room to estimate the same work twice.
    """
    stmt = select(Task).where(
        Task.project_id == project_id, Task.story_points.is_(None)
    )
    if sprint_id is not None:
        stmt = stmt.where(Task.sprint_id == sprint_id)
    rows = db.execute(
        tasks_svc.leaf_only(stmt).order_by(Task.rank, Task.id)
    ).scalars().all()
    return [t.id for t in rows]


def close_session(db: Session, session: PokerSession) -> PokerSession:
    session.status = "closed"
    session.closed_at = _now()
    db.commit()
    db.refresh(session)
    return session


def delete_session(db: Session, session_id: int) -> None:
    """Tolerant delete; rounds and votes cascade."""
    session = db.get(PokerSession, session_id)
    if session is not None:
        db.delete(session)
        db.commit()


# -------------------------------------------------------------------- rounds


def _round_of_session(db: Session, round_id: int) -> PokerRound:
    row = db.get(PokerRound, round_id)
    if row is None:
        raise HTTPException(404, "Round not found")
    return row


def _latest_rounds(db: Session, session_id: int) -> list[PokerRound]:
    """One round per task — the newest attempt — in queue order."""
    rows = db.execute(
        select(PokerRound)
        .where(PokerRound.session_id == session_id)
        .order_by(PokerRound.id)
        .options(selectinload(PokerRound.votes), selectinload(PokerRound.task))
    ).scalars().all()
    newest: dict[int, PokerRound] = {}
    for row in rows:
        seen = newest.get(row.task_id)
        if seen is None or row.attempt > seen.attempt:
            newest[row.task_id] = row
    # Preserve first-seen task order, which is the order they were queued.
    order: list[int] = []
    for row in rows:
        if row.task_id not in order:
            order.append(row.task_id)
    return [newest[tid] for tid in order]


def open_round(
    db: Session, session: PokerSession, data: PokerRoundCreateIn
) -> PokerRound:
    """Queue another task mid-session."""
    task = db.get(Task, data.task_id)
    if task is None or task.project_id != session.project_id:
        raise HTTPException(404, "Task not found in this project")
    highest = db.execute(
        select(func.max(PokerRound.attempt)).where(
            PokerRound.session_id == session.id, PokerRound.task_id == task.id
        )
    ).scalar()
    row = PokerRound(
        session_id=session.id,
        task_id=task.id,
        attempt=int(highest or 0) + 1,
        status="voting",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def cast_vote(db: Session, round_id: int, data: PokerVoteIn) -> PokerRound:
    """Upsert one member's card. 409 once the round is no longer open."""
    row = _round_of_session(db, round_id)
    if row.status != "voting":
        raise HTTPException(
            409, "This round is already revealed — start a re-vote to change an estimate."
        )
    if db.get(Member, data.member_id) is None:
        raise HTTPException(404, "Member not found")

    vote = db.execute(
        select(PokerVote).where(
            PokerVote.round_id == round_id, PokerVote.member_id == data.member_id
        )
    ).scalar_one_or_none()

    # points=None and abstain=False means "take my card back".
    if data.points is None and not data.abstain:
        if vote is not None:
            db.delete(vote)
        db.commit()
        db.refresh(row)
        return row

    if vote is None:
        vote = PokerVote(round_id=round_id, member_id=data.member_id)
        db.add(vote)
    vote.points = None if data.abstain else data.points
    vote.abstain = data.abstain
    db.commit()
    db.refresh(row)
    return row


def reveal_round(db: Session, round_id: int) -> PokerRound:
    """Show every card. Idempotent — a second caller gets the same round back."""
    row = _round_of_session(db, round_id)
    if row.status == "voting":
        row.status = "revealed"
        row.revealed_at = _now()
        db.commit()
        db.refresh(row)
    return row


def revote(db: Session, round_id: int) -> PokerRound:
    """Start a fresh attempt on the same task after a discussion.

    The previous attempt is kept (marked `skipped`) rather than cleared, so the
    history of how an estimate moved is still there afterwards.
    """
    row = _round_of_session(db, round_id)
    if row.status == "applied":
        raise HTTPException(409, "This round was already applied")
    row.status = "skipped"
    fresh = PokerRound(
        session_id=row.session_id,
        task_id=row.task_id,
        attempt=row.attempt + 1,
        status="voting",
    )
    db.add(fresh)
    db.commit()
    db.refresh(fresh)
    return fresh


def apply_round(db: Session, round_id: int, data: PokerApplyIn) -> PokerApplyOut:
    """Write the agreed estimate to the task and settle the round."""
    row = _round_of_session(db, round_id)
    if row.status == "applied":
        raise HTTPException(409, "This round was already decided")
    if row.status == "voting":
        raise HTTPException(409, "Reveal the votes before deciding an estimate")

    task = db.get(Task, row.task_id)
    if task is None:
        raise HTTPException(404, "Task not found")

    task.story_points = data.points
    task.updated_at_src = _now()
    row.status = "applied"
    row.final_points = data.points
    row.note = (data.note or "").strip() or None
    row.applied_at = _now()
    db.commit()
    db.refresh(row)

    # Advisory only: the room decided, and the scale gets to comment.
    warnings = scale_svc.check_estimate(db, task.project_id, task, data.points)
    return PokerApplyOut(
        round=round_out(row, revealed=True),
        task_id=task.id,
        story_points=data.points,
        warnings=warnings,
    )


# ------------------------------------------------------------ serialization


def _stats(votes: list[PokerVote], deck: list[float]) -> PokerStatsOut:
    """Spread over the cards that expressed a number.

    Abstains are counted but excluded from the maths — a "?" means "I can't
    estimate this", and folding it in as a zero would drag consensus down.
    """
    numeric = [v.points for v in votes if not v.abstain and v.points is not None]
    abstains = len([v for v in votes if v.abstain])
    if not numeric:
        return PokerStatsOut(votes=len(votes), abstains=abstains)

    median = float(statistics.median(numeric))
    # Round the median up to a real card: estimating between two values isn't
    # something the scale can express, and rounding down understates risk.
    suggested = next((p for p in sorted(deck) if p >= median), max(deck) if deck else median)
    return PokerStatsOut(
        votes=len(votes),
        abstains=abstains,
        low=min(numeric),
        high=max(numeric),
        median=median,
        consensus=len(set(numeric)) == 1,
        suggested=float(suggested),
    )


def round_out(
    row: PokerRound,
    *,
    revealed: bool,
    deck: list[float] | None = None,
    for_member_id: int | None = None,
) -> PokerRoundOut:
    """Serialize a round, withholding vote values unless it has been revealed.

    `for_member_id` un-redacts that member's *own* card. Without it the 2s poll
    would keep wiping the caller's selected card back to nothing — and telling
    someone what they themselves just picked leaks nothing. Everyone else's
    card stays hidden until the reveal.
    """
    votes: list[PokerVoteOut] = []
    for vote in sorted(row.votes, key=lambda v: v.member_id):
        name = vote.member.display_name if vote.member else f"Member {vote.member_id}"
        out = PokerVoteOut(
            member_id=vote.member_id, display_name=name, voted_at=vote.updated_at
        )
        if revealed or vote.member_id == for_member_id:
            out.points = vote.points
            out.abstain = vote.abstain
        votes.append(out)

    return PokerRoundOut(
        id=row.id,
        session_id=row.session_id,
        task_id=row.task_id,
        task_key=tasks_svc.task_label(row.task) if row.task else None,
        task_title=row.task.title if row.task else "",
        attempt=row.attempt,
        status=row.status,
        final_points=row.final_points,
        note=row.note,
        revealed_at=row.revealed_at,
        applied_at=row.applied_at,
        votes=votes,
        stats=_stats(row.votes, deck or []) if revealed else None,
    )


def session_out(db: Session, session: PokerSession) -> PokerSessionOut:
    rounds = _latest_rounds(db, session.id)
    return PokerSessionOut(
        id=session.id,
        project_id=session.project_id,
        sprint_id=session.sprint_id,
        sprint_name=session.sprint.name if session.sprint else None,
        name=session.name,
        status=session.status,
        deck=session.deck or [],
        breakdown_points=session.breakdown_points or [],
        created_at=session.created_at,
        closed_at=session.closed_at,
        queued=len(rounds),
        estimated=len([r for r in rounds if r.status == "applied"]),
    )


def list_sessions(db: Session, project_id: int) -> list[PokerSessionOut]:
    sessions = db.execute(
        select(PokerSession)
        .where(PokerSession.project_id == project_id)
        .order_by(PokerSession.id.desc())
    ).scalars().all()
    return [session_out(db, s) for s in sessions]


def build_detail(
    db: Session, session: PokerSession, for_member_id: int | None = None
) -> PokerSessionDetail:
    """The 2s poll payload: session, participants, current round, queue.

    Everything in one object so a reveal is atomic from the client's point of
    view — the status flip and the un-redacted votes arrive together, and votes
    can never appear to trickle in one poll at a time.
    """
    rounds = _latest_rounds(db, session.id)
    active = next((r for r in rounds if r.status in ("voting", "revealed")), None)

    members = db.execute(
        select(Member)
        .join(ProjectMember, ProjectMember.member_id == Member.id)
        .where(ProjectMember.project_id == session.project_id)
        .order_by(Member.display_name)
    ).scalars().all()
    voted = {v.member_id for v in (active.votes if active else [])}

    participants = [
        PokerParticipantOut(
            member_id=m.id, display_name=m.display_name, has_voted=m.id in voted
        )
        for m in members
    ]
    # Someone who voted and was then removed from the project keeps their card
    # and stays visible, rather than the round losing a vote mid-session.
    known = {m.id for m in members}
    for vote in active.votes if active else []:
        if vote.member_id not in known:
            participants.append(
                PokerParticipantOut(
                    member_id=vote.member_id,
                    display_name=(
                        f"{vote.member.display_name} (removed)"
                        if vote.member
                        else f"Member {vote.member_id}"
                    ),
                    has_voted=True,
                    off_project=True,
                )
            )

    deck = [float(p) for p in (session.deck or [])]
    detail = PokerSessionDetail(
        **session_out(db, session).model_dump(),
        participants=participants,
        current_round=(
            round_out(
                active,
                revealed=active.status != "voting",
                deck=deck,
                for_member_id=for_member_id,
            )
            if active
            else None
        ),
        queue=[
            PokerQueueItemOut(
                task_id=r.task_id,
                task_key=tasks_svc.task_label(r.task) if r.task else None,
                task_title=r.task.title if r.task else "",
                story_points=r.task.story_points if r.task else None,
                round_status=r.status,
                attempts=r.attempt,
            )
            for r in rounds
        ],
    )
    return detail
