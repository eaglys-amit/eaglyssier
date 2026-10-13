"""User administration (admin only; see the /users rules in app.api.authz)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.authz import Access, get_access
from app.api.deps import get_or_404
from app.db import get_db
from app.models import Member, Project, ProjectMember, ProjectRole, User
from app.schemas.auth import BulkMembershipIn, UserCreate, UserOut, UserPatch
from app.services import auth as auth_svc

router = APIRouter()


def _out(user: User) -> UserOut:
    return UserOut.model_validate(user).model_copy(
        update={"member_name": user.member.display_name if user.member else None}
    )


def _check_member(db: Session, member_id: int | None, user_id: int | None = None) -> None:
    if member_id is None:
        return
    get_or_404(db, Member, member_id)
    taken = db.execute(
        select(User.id).where(User.member_id == member_id, User.id != (user_id or -1))
    ).scalar()
    if taken:
        raise HTTPException(409, "That member already has a login")


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    users = db.execute(
        select(User).options(selectinload(User.member)).order_by(User.email)
    ).scalars().all()
    return [_out(u) for u in users]


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    email = auth_svc.normalize_email(body.email)
    if "@" not in email:
        raise HTTPException(400, "Enter a valid email")
    if problem := auth_svc.validate_password(body.password):
        raise HTTPException(400, problem)
    _check_member(db, body.member_id)
    user = User(
        email=email,
        password_hash=auth_svc.hash_password(body.password),
        is_admin=body.is_admin,
        member_id=body.member_id,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A user with that email already exists")
    db.refresh(user)
    return _out(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def patch_user(
    user_id: int,
    body: UserPatch,
    db: Session = Depends(get_db),
    access: Access = Depends(get_access),
):
    user = get_or_404(db, User, user_id)
    is_self = user.id == access.user.id
    if is_self and (body.is_admin is False or body.is_active is False):
        # Guard against locking the last admin (and yourself) out.
        raise HTTPException(400, "You cannot remove your own admin access")
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.unlink_member:
        user.member_id = None
    elif body.member_id is not None:
        _check_member(db, body.member_id, user.id)
        user.member_id = body.member_id
    revoke = body.is_active is False
    if body.password:
        if problem := auth_svc.validate_password(body.password):
            raise HTTPException(400, problem)
        user.password_hash = auth_svc.hash_password(body.password)
        revoke = True
    db.commit()
    if revoke and not is_self:
        auth_svc.revoke_user_sessions(db, user.id)
    db.refresh(user)
    return _out(user)


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int, db: Session = Depends(get_db), access: Access = Depends(get_access)
):
    if user_id == access.user.id:
        raise HTTPException(400, "You cannot delete yourself")
    user = db.get(User, user_id)
    if user:
        db.delete(user)
        db.commit()


@router.post("/users/{user_id}/memberships", response_model=UserOut)
def enroll_everywhere(user_id: int, body: BulkMembershipIn, db: Session = Depends(get_db)):
    """Add the user's member to every project with `role` (existing roles are kept)."""
    if body.role not in {r.value for r in ProjectRole}:
        raise HTTPException(400, "Unknown role")
    user = get_or_404(db, User, user_id)
    if user.member_id is None:
        raise HTTPException(400, "Link the user to a member first")
    existing = set(db.execute(
        select(ProjectMember.project_id).where(ProjectMember.member_id == user.member_id)
    ).scalars())
    for pid in db.execute(select(Project.id)).scalars():
        if pid not in existing:
            db.add(ProjectMember(project_id=pid, member_id=user.member_id, role=body.role))
    db.commit()
    return _out(user)
