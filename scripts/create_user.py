"""Create (or reset the password of) a login from the command line.

Run inside the app container:
    python scripts/create_user.py admin@example.com --admin
    python scripts/create_user.py dev@example.com --member-email dev@example.com

The password is prompted for (or read from $NEW_PASSWORD for scripting).
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Member, User
from app.services.auth import hash_password, normalize_email, validate_password


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("email")
    parser.add_argument("--admin", action="store_true", help="grant admin rights")
    parser.add_argument("--member-email", help="link to the member with this primary email")
    args = parser.parse_args()

    password = os.environ.get("NEW_PASSWORD") or getpass.getpass("Password: ")
    if problem := validate_password(password):
        print(problem, file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        member_id = None
        if args.member_email:
            member = db.execute(
                select(Member).where(Member.primary_email == args.member_email)
            ).scalars().first()
            if member is None:
                print(f"No member with email {args.member_email}", file=sys.stderr)
                return 1
            member_id = member.id

        email = normalize_email(args.email)
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            user = User(email=email, password_hash="")
            db.add(user)
            action = "Created"
        else:
            action = "Updated"
        user.password_hash = hash_password(password)
        user.is_admin = user.is_admin or args.admin
        user.is_active = True
        if member_id is not None:
            user.member_id = member_id
        db.commit()
        print(f"{action} {email}{' (admin)' if user.is_admin else ''}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
