"""Login/logout and the current user. Mounted outside the authorized /api router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.authz import current_user, memberships
from app.config import settings
from app.db import get_db
from app.models import User
from app.schemas.auth import LoginIn, MeOut, MembershipOut, PasswordChangeIn
from app.services import auth as auth_svc

router = APIRouter(prefix="/api/auth")


def _me(db: Session, user: User) -> MeOut:
    return MeOut(
        id=user.id,
        email=user.email,
        is_admin=user.is_admin,
        member_id=user.member_id,
        display_name=user.member.display_name if user.member else user.email,
        memberships=[
            MembershipOut(project_id=pid, role=role)
            for pid, role in sorted(memberships(db, user).items())
        ],
    )


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = auth_svc.authenticate(db, body.email, body.password)
    if user is None:
        raise HTTPException(401, "Invalid email or password")
    token, expires = auth_svc.create_session(db, user)
    response.set_cookie(
        auth_svc.SESSION_COOKIE,
        token,
        expires=expires,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return _me(db, user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth_svc.revoke_session(db, request.cookies.get(auth_svc.SESSION_COOKIE))
    response.delete_cookie(auth_svc.SESSION_COOKIE, path="/")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _me(db, user)


@router.post("/password", status_code=204)
def change_password(
    body: PasswordChangeIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not auth_svc.verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    if problem := auth_svc.validate_password(body.new_password):
        raise HTTPException(400, problem)
    user.password_hash = auth_svc.hash_password(body.new_password)
    db.commit()
    # Sign out other devices; keep this one.
    auth_svc.revoke_user_sessions(
        db, user.id, keep_token=request.cookies.get(auth_svc.SESSION_COOKIE)
    )
