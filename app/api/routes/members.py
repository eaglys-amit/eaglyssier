"""Global members: the curated people directory."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Member
from app.schemas.member import MemberCreate, MemberOut, MemberPatch

router = APIRouter()


@router.get("/members", response_model=list[MemberOut])
def list_members(db: Session = Depends(get_db)):
    return db.execute(select(Member).order_by(Member.display_name)).scalars().all()


@router.post("/members", response_model=MemberOut, status_code=201)
def create_member(body: MemberCreate, db: Session = Depends(get_db)):
    member = Member(
        display_name=body.display_name.strip(),
        primary_email=(body.primary_email or "").strip() or None,
    )
    db.add(member)
    db.commit()
    return member


@router.patch("/members/{member_id}", response_model=MemberOut)
def rename_member(member_id: int, body: MemberPatch, db: Session = Depends(get_db)):
    member = get_or_404(db, Member, member_id)
    member.display_name = body.display_name.strip()
    db.commit()
    return member


@router.delete("/members/{member_id}", status_code=204)
def delete_member(member_id: int, db: Session = Depends(get_db)):
    # Deleting a member unmaps their discovered accounts (FK ondelete SET NULL)
    # and removes their project memberships (cascade); the accounts themselves stay.
    member = db.get(Member, member_id)
    if member:
        db.delete(member)
        db.commit()
