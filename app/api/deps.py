"""Shared helpers for the JSON API routes."""
from __future__ import annotations

from typing import Callable, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.db import SessionLocal

T = TypeVar("T")


def get_or_404(db: Session, model: type[T], obj_id: int, label: str | None = None) -> T:
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, f"{label or model.__name__} not found")
    return obj


def run_in_session(fn: Callable, *args) -> None:
    """Background task wrapper: run `fn(db, *args)` in its own session.

    The request session is closed by the time BackgroundTasks fire, so every
    job opens (and always closes) a fresh one.
    """
    db = SessionLocal()
    try:
        fn(db, *args)
    finally:
        db.close()
