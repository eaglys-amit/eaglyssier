"""Planning poker: rounds, hidden votes, reveal, and writing the estimate back.

Three rules shape this module:

**Votes are hidden server-side.** The frontend polls ``GET /poker/{id}`` every
two seconds, so while a round is still ``voting`` the payload carries who has
voted but never what they picked — :func:`round_out` simply doesn't copy the
values across. Hiding in the UI would be theatre: anyone can curl the endpoint.
(The keys still serialize as null; the client decides whether to render a value
from ``round.status``, never from the presence of the field.)

**Only the facilitator reveals.** Whoever starts the session holds that
control, so one early click can't turn the cards over while people are still
thinking. It is advisory — the member id is self-declared, like the votes — and
:func:`set_facilitator` exists precisely so a closed tab can't strand the room.
Revealing stays idempotent: two clicks from the facilitator are one reveal.

**Nothing auto-advances.** The ``voted / participants`` counter is advisory. An
auto-reveal at "everyone voted" would fire in the face of someone who joined a
millisecond after the last vote and hasn't read the task yet.
"""
from __future__ import annotations

import statistics
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Member,
    PokerRound,
    PokerSession,
    PokerVote,
    ProjectMember,
    Sprint,
    StatusCategory,
    Task,
)
from app.schemas.poker import (
    PokerApplyIn,
    PokerApplyOut,
    PokerCandidateOut,
    PokerCandidatesOut,
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

    task_ids = data.task_ids or [
        t.id
        for t in candidate_tasks(
            db,
            project_id,
            include_sprint_tasks=data.include_sprint_tasks,
            include_proposed=data.include_proposed,
        )
    ]
    if not task_ids:
        raise HTTPException(
            409,
            "Nothing in the backlog needs an estimate."
            if not (data.include_sprint_tasks or data.include_proposed)
            else "Nothing matches that scope — every task already has an agreed estimate.",
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
        facilitator_member_id=data.facilitator_member_id,
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


def candidate_tasks(
    db: Session,
    project_id: int,
    *,
    include_sprint_tasks: bool = False,
    include_proposed: bool = False,
) -> list[Task]:
    """Unestimated work the room could put on the table, in board order.

    The backlog is the default and usually the whole answer: estimating is what
    you do *before* planning, so the unplanned column is the natural queue.
    Sweeping every sprint as well would drag a dozen in-flight tickets into a
    refinement session nobody asked to re-litigate.

    ``include_sprint_tasks`` adds work already sitting in a sprint but still
    **To Do** — the carried-over tickets that never got a number. Anything in
    progress or done is left alone: estimating it after the fact is noise.

    ``include_proposed`` adds tasks that *do* have points but only because an AI
    breakdown proposed them (``estimate_source == 'ai'``). Those look estimated
    and would otherwise never reach the table, so the model's guess would stand
    unchallenged. A poker round overwrites the number and marks it agreed, at
    which point it stops matching this scope.

    Leaves only, as everywhere: a container's points roll up from its children,
    so putting an epic on the table would ask the room to estimate the same
    work twice.
    """
    # Either there is no estimate at all, or there is one the team never agreed.
    estimate_state = Task.story_points.is_(None)
    if include_proposed:
        estimate_state = or_(estimate_state, Task.estimate_source == "ai")

    placement = (
        or_(Task.sprint_id.is_(None), Task.status_category == StatusCategory.todo)
        if include_sprint_tasks
        else Task.sprint_id.is_(None)
    )
    stmt = select(Task).where(Task.project_id == project_id, estimate_state, placement)
    return list(
        db.execute(tasks_svc.leaf_only(stmt).order_by(Task.rank, Task.id)).scalars().all()
    )


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


def reveal_round(db: Session, round_id: int, member_id: int | None = None) -> PokerRound:
    """Show every card. Facilitator only; idempotent for them.

    A session with no facilitator (created before the lock, or whose
    facilitator was deleted) falls back to open reveal rather than becoming
    permanently unrevealable.
    """
    row = _round_of_session(db, round_id)
    facilitator = row.session.facilitator_member_id
    if facilitator is not None and member_id != facilitator:
        name = row.session.facilitator.display_name if row.session.facilitator else "the facilitator"
        raise HTTPException(
            403,
            f"Only {name} can reveal this round — they started the session. "
            "They can hand over facilitation if they've dropped out.",
        )
    if row.status == "voting":
        row.status = "revealed"
        row.revealed_at = _now()
        db.commit()
        db.refresh(row)
    return row


def set_facilitator(db: Session, session: PokerSession, member_id: int) -> PokerSession:
    """Hand facilitation to someone else.

    The escape hatch for the reveal lock: without it, the facilitator closing
    their tab would leave a room that can vote but never turn the cards over.
    Deliberately not silent — the UI attributes the change.
    """
    if db.get(Member, member_id) is None:
        raise HTTPException(404, "Member not found")
    session.facilitator_member_id = member_id
    db.commit()
    db.refresh(session)
    return session


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
    # The room has spoken: this is no longer a proposal, so it drops out of the
    # "re-estimate AI proposals" scope.
    task.estimate_source = "poker"
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
        task_description=row.task.description if row.task else None,
        task_acceptance_criteria=row.task.acceptance_criteria if row.task else None,
        task_issue_type=row.task.issue_type if row.task else None,
        attempt=row.attempt,
        status=row.status,
        final_points=row.final_points,
        note=row.note,
        revealed_at=row.revealed_at,
        applied_at=row.applied_at,
        votes=votes,
        stats=_stats(row.votes, deck or []) if revealed else None,
        proposed_points=(
            row.task.story_points
            if revealed and row.task is not None and row.task.estimate_source == "ai"
            else None
        ),
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
        facilitator_member_id=session.facilitator_member_id,
        facilitator_name=(
            session.facilitator.display_name if session.facilitator else None
        ),
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
                task_description=r.task.description if r.task else None,
                story_points=r.task.story_points if r.task else None,
                round_status=r.status,
                attempts=r.attempt,
            )
            for r in rounds
        ],
    )
    return detail


def build_candidates(db: Session, project_id: int) -> PokerCandidatesOut:
    """Split the estimable work into backlog vs already-in-a-sprint.

    The UI shows both counts up front: a session that silently queues thirty
    tickets is one nobody finishes.
    """
    rows = candidate_tasks(
        db, project_id, include_sprint_tasks=True, include_proposed=True
    )
    names = dict(
        db.execute(
            select(Sprint.id, Sprint.name).where(Sprint.project_id == project_id)
        ).all()
    )
    out = PokerCandidatesOut()
    for task in rows:
        item = PokerCandidateOut(
            task_id=task.id,
            task_key=tasks_svc.task_label(task),
            title=task.title,
            sprint_id=task.sprint_id,
            sprint_name=names.get(task.sprint_id) if task.sprint_id else None,
            proposed_points=task.story_points,
        )
        # An AI proposal is its own bucket wherever it sits: the question there
        # is "do we agree with the model", not "does this need a number".
        if task.estimate_source == "ai" and task.story_points is not None:
            out.proposed.append(item)
        elif task.sprint_id is None:
            out.backlog.append(item)
        else:
            out.in_sprints.append(item)
    return out
