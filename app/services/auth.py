"""Passwords, login sessions and the first-admin bootstrap.

Passwords use stdlib scrypt, so there is no extra dependency. Sessions are
opaque random tokens kept in an HttpOnly cookie; only their sha256 is stored,
which makes logout (and revoking every session of a user) a row delete.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User, UserSession

SESSION_COOKIE = "eaglyssier_session"
MIN_PASSWORD_LENGTH = 8

# scrypt cost: 2**14 * 8 * 128 bytes = 16 MB per hash, well under OpenSSL's 32 MB cap.
_N, _R, _P = 2**14, 8, 1


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt),
            n=int(n), r=int(r), p=int(p), dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def validate_password(password: str) -> str | None:
    """Return why a new password is unacceptable, or None if it's fine."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    return None


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.execute(
        select(User).where(User.email == normalize_email(email))
    ).scalar_one_or_none()
    if user is None:
        # Spend the same work as a real check so timing doesn't reveal which emails exist.
        verify_password(password, _DUMMY_HASH)
        return None
    if not user.is_active or not verify_password(password, user.password_hash):
        return None
    return user


def create_session(db: Session, user: User) -> tuple[str, datetime]:
    """Start a session for `user`; returns the cookie token and its expiry."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=settings.session_days)
    db.add(UserSession(user_id=user.id, token_hash=_token_hash(token), expires_at=expires))
    user.last_login_at = now
    # Opportunistic cleanup, so expired rows don't pile up without a cron job.
    db.execute(delete(UserSession).where(UserSession.expires_at < now))
    db.commit()
    return token, expires


def resolve_session(db: Session, token: str | None) -> User | None:
    """The active user behind a cookie token, or None if missing/expired/disabled."""
    if not token:
        return None
    row = db.execute(
        select(UserSession).where(
            UserSession.token_hash == _token_hash(token),
            UserSession.expires_at > datetime.now(timezone.utc),
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    return user


def revoke_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))
        db.commit()


def revoke_user_sessions(db: Session, user_id: int, *, keep_token: str | None = None) -> None:
    """End every session of a user (password reset, deactivation), optionally but one."""
    stmt = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_token:
        stmt = stmt.where(UserSession.token_hash != _token_hash(keep_token))
    db.execute(stmt)
    db.commit()


def bootstrap_admin(db: Session) -> None:
    """Create the ADMIN_EMAIL admin while no user exists yet (first boot)."""
    if not (settings.admin_email and settings.admin_password):
        return
    if db.execute(select(func.count(User.id))).scalar_one():
        return
    db.add(User(
        email=normalize_email(settings.admin_email),
        password_hash=hash_password(settings.admin_password),
        is_admin=True,
    ))
    db.commit()
    logging.getLogger("startup").info("Created initial admin %s", settings.admin_email)


_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
