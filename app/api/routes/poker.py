"""Planning poker: sessions, rounds, votes, reveal, and applying the estimate.

`GET /poker/{session_id}` is the 2s poll target the whole UI runs on. It
withholds vote values while a round is still open — see app.services.poker.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import PokerSession, Project
from app.schemas.poker import (
    PokerApplyIn,
    PokerApplyOut,
    PokerRoundCreateIn,
    PokerRoundOut,
    PokerSessionCreateIn,
    PokerSessionDetail,
    PokerSessionOut,
    PokerVoteIn,
)
from app.services import poker as poker_svc

router = APIRouter()


def _session(db: Session, session_id: int) -> PokerSession:
    return get_or_404(db, PokerSession, session_id, "Poker session")


@router.get("/projects/{project_id}/poker", response_model=list[PokerSessionOut])
def list_poker_sessions(project_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Project, project_id)
    return poker_svc.list_sessions(db, project_id)


@router.post(
    "/projects/{project_id}/poker", response_model=PokerSessionOut, status_code=201
)
def create_poker_session(
    project_id: int, body: PokerSessionCreateIn, db: Session = Depends(get_db)
):
    """Open a session and queue its tasks.

    409 when the project has no story-point scale (no cards to deal) or when
    every candidate task is already estimated.
    """
    get_or_404(db, Project, project_id)
    session = poker_svc.create_session(db, project_id, body)
    return poker_svc.session_out(db, session)


@router.get("/poker/{session_id}", response_model=PokerSessionDetail)
def poker_session_detail(
    session_id: int, me: int | None = None, db: Session = Depends(get_db)
):
    """**The 2s poll target.** Vote values are withheld until the round is revealed.

    `me` is the caller's own member id. Their card comes back un-redacted —
    otherwise every poll would wipe the selection out of their own UI — while
    everyone else's stays hidden. It's self-declared, but it only ever reveals
    what that browser already chose.
    """
    return poker_svc.build_detail(db, _session(db, session_id), for_member_id=me)


@router.post("/poker/{session_id}/close", response_model=PokerSessionOut)
def close_poker_session(session_id: int, db: Session = Depends(get_db)):
    session = poker_svc.close_session(db, _session(db, session_id))
    return poker_svc.session_out(db, session)


@router.delete("/poker/{session_id}", status_code=204)
def delete_poker_session(session_id: int, db: Session = Depends(get_db)):
    """Tolerant delete; rounds and votes cascade."""
    poker_svc.delete_session(db, session_id)


@router.post("/poker/{session_id}/rounds", response_model=PokerRoundOut, status_code=201)
def open_poker_round(
    session_id: int, body: PokerRoundCreateIn, db: Session = Depends(get_db)
):
    """Queue another task mid-session."""
    session = _session(db, session_id)
    row = poker_svc.open_round(db, session, body)
    return poker_svc.round_out(row, revealed=False)


@router.post("/poker/rounds/{round_id}/vote", response_model=PokerRoundOut)
def cast_poker_vote(round_id: int, body: PokerVoteIn, db: Session = Depends(get_db)):
    """Upsert the caller's card. 409 once the round has been revealed.

    Returns the round with values still withheld — casting a vote must not leak
    what everyone else picked.
    """
    row = poker_svc.cast_vote(db, round_id, body)
    return poker_svc.round_out(row, revealed=False, for_member_id=body.member_id)


@router.post("/poker/rounds/{round_id}/reveal", response_model=PokerRoundOut)
def reveal_poker_round(round_id: int, db: Session = Depends(get_db)):
    """Show every card. Idempotent, and anyone in the room may call it."""
    row = poker_svc.reveal_round(db, round_id)
    deck = [float(p) for p in (row.session.deck or [])]
    return poker_svc.round_out(row, revealed=True, deck=deck)


@router.post("/poker/rounds/{round_id}/revote", response_model=PokerRoundOut, status_code=201)
def revote_poker_round(round_id: int, db: Session = Depends(get_db)):
    """Fresh attempt on the same task after a discussion."""
    row = poker_svc.revote(db, round_id)
    return poker_svc.round_out(row, revealed=False)


@router.post("/poker/rounds/{round_id}/apply", response_model=PokerApplyOut)
def apply_poker_round(round_id: int, body: PokerApplyIn, db: Session = Depends(get_db)):
    """Write the agreed estimate to the task; returns any scale warnings."""
    return poker_svc.apply_round(db, round_id, body)
