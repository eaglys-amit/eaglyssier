"""Periodic sync scheduler (APScheduler, in-process).

Runs every enabled integration on a fixed interval. Kept in-process to avoid a
separate worker/broker in iteration 1.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Integration, IntegrationType, Project, Report, ReportStatus
from app.services.burndown import snapshot_all_active
from app.services.reports import EXECUTIVE, generate_report
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


def snapshot_active_sprints() -> None:
    """Daily burndown sample for every active sprint.

    build_burndown also samples on read, so a missed run costs at most a gap on
    a day nobody opened the chart — but the scheduled job is what makes the
    series complete for sprints nobody looks at mid-flight.
    """
    db = SessionLocal()
    try:
        written = snapshot_all_active(db)
        if written:
            log.info("Snapshotted %d active sprint(s) for the burndown.", written)
    finally:
        db.close()


def weekly_exec_scope(today: date) -> dict:
    """The past seven days, ending yesterday: the week the Monday report covers."""
    return {
        "kind": EXECUTIVE,
        "start": (today - timedelta(days=7)).isoformat(),
        "end": (today - timedelta(days=1)).isoformat(),
    }


def generate_weekly_exec_reports() -> None:
    """Monday: an executive report for every project that opted in."""
    db = SessionLocal()
    try:
        project_ids = db.execute(
            select(Project.id).where(Project.exec_report_weekly.is_(True))
        ).scalars().all()
        scope = weekly_exec_scope(date.today())
        for pid in project_ids:
            try:
                report = Report(
                    project_id=pid, report_type="executive", scope=dict(scope),
                    title="Weekly executive summary (generating…)", status=ReportStatus.pending,
                )
                db.add(report)
                db.commit()
                generate_report(db, report.id)
                log.info("Weekly executive report %s for project %s: %s",
                         report.id, pid, report.status)
            except Exception:  # noqa: BLE001
                db.rollback()
                log.exception("Weekly executive report failed for project %s", pid)
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
    # Once a day, just after midnight UTC: a burndown wants one reading per day,
    # not one per sync interval.
    scheduler.add_job(
        snapshot_active_sprints,
        "cron",
        hour=0,
        minute=5,
        id="snapshot_sprints",
        replace_existing=True,
    )
    # Monday morning (09:30 JST): last week's executive summary is ready to read.
    scheduler.add_job(
        generate_weekly_exec_reports,
        "cron",
        day_of_week="mon",
        hour=0,
        minute=30,
        id="exec_reports",
        replace_existing=True,
    )
    scheduler.start()
    log.info("Scheduler started (interval=%s min)", settings.sync_interval_minutes)


def shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
