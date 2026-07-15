"""Periodic sync scheduler (APScheduler, in-process).

Runs every enabled integration on a fixed interval. Kept in-process to avoid a
separate worker/broker in iteration 1.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Integration, IntegrationType
from app.services.sync import sync_integration

log = logging.getLogger("scheduler")

# Types that actually pull data in iteration 1 (stubs are skipped).
_ACTIVE_TYPES = {IntegrationType.jira, IntegrationType.github, IntegrationType.gitlab}

scheduler = BackgroundScheduler(timezone="UTC")


def sync_all_enabled() -> None:
    db = SessionLocal()
    try:
        integrations = db.execute(
            select(Integration).where(
                Integration.enabled.is_(True), Integration.type.in_(_ACTIVE_TYPES)
            )
        ).scalars().all()
        for integ in integrations:
            try:
                run = sync_integration(db, integ.id)
                if run is None:
                    log.info("Integration %s sync skipped (already running).", integ.id)
                else:
                    log.info("Synced integration %s -> %s %s", integ.id, run.status, run.stats)
            except Exception:  # noqa: BLE001
                log.exception("Scheduled sync failed for integration %s", integ.id)
    finally:
        db.close()


def start() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        sync_all_enabled,
        "interval",
        minutes=settings.sync_interval_minutes,
        id="sync_all",
        replace_existing=True,
    )
    scheduler.start()
    log.info("Scheduler started (interval=%s min)", settings.sync_interval_minutes)


def shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
