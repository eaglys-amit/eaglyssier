"""Aggregate DB rows into a typed ReportContext.

Scope is either a single sprint (sprint report) or a whole project / date range
(project report). Git contribution is scoped by the sprint window when available.
"""
from __future__ import annotations

import statistics
from datetime import date, datetime, timezone
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Commit,
    Deliverable,
    GitRepo,
    Member,
    Project,
    PRReview,
    PullRequest,
    Sprint,
    StatusCategory,
    Task,
)
from app.schemas.report import (
    DataQuality,
    DeliverableItem,
    FlowMetrics,
    MemberReport,
    ProjectInfo,
    ReportContext,
    ReportSummary,
    SprintBreakdownRow,
    SprintInfo,
    TaskItem,
    TypeBreakdownRow,
)


def _hours(seconds: int | None) -> float:
    return round((seconds or 0) / 3600.0, 1)


def build_report_context(
    db: Session, project_id: int, scope: dict | None = None
) -> ReportContext:
    """Build the report context for a scope.

    scope keys (all optional):
      * sprint_ids: list[int]  -> those sprints (one = sprint report, many = closing)
      * sprint_id: int         -> legacy single-sprint
      * start / end: ISO dates -> tasks updated within the window (period report)
      * (empty)                -> whole project closing review
    """
    project = db.get(Project, project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    sc = _resolve_scope(db, project_id, scope or {})
    sprint = sc.single_sprint
    report_type = "sprint" if sc.is_single_sprint else "project"

    tasks = sc.tasks
    members: dict[int, MemberReport] = {}
    member_names = _member_lookup(db)

    # ---- task / story-point aggregation -----------------------------------
    summary = ReportSummary()
    dq = DataQuality()
    # per-member flow samples (days), computed into medians after the loop
    member_lead: dict[int, list[float]] = {}
    member_cycle: dict[int, list[float]] = {}
    for t in tasks:
        summary.total_tasks += 1
        if t.status_category == StatusCategory.done:
            summary.tasks_done += 1
        elif t.status_category == StatusCategory.in_progress:
            summary.tasks_in_progress += 1
        else:
            summary.tasks_todo += 1
        if t.story_points:
            summary.assigned_sp += t.story_points
            if t.status_category == StatusCategory.done:
                summary.completed_sp += t.story_points
        else:
            dq.tasks_without_points += 1
        # curated member is resolved via the discovered account (identity); a task
        # whose assignee account isn't mapped to a member counts as unassigned here.
        assignee_mid = t.assignee.member_id if t.assignee else None
        if assignee_mid is None:
            dq.unassigned_tasks += 1
        if (t.reopened_count or 0) > 0:
            dq.reopened_tasks += 1
        summary.total_hours += _hours(t.worklog_seconds)

        if assignee_mid:
            mr = _member(members, assignee_mid, member_names)
            mr.tasks_total += 1
            mr.hours += _hours(t.worklog_seconds)
            if t.story_points:
                mr.assigned_sp += t.story_points
            if t.status_category == StatusCategory.done:
                mr.tasks_done += 1
                if t.story_points:
                    mr.completed_sp += t.story_points
                if t.created_at_src and t.resolved_at_src and t.resolved_at_src >= t.created_at_src:
                    member_lead.setdefault(assignee_mid, []).append(
                        (t.resolved_at_src - t.created_at_src).total_seconds() / 86400.0
                    )
                if t.started_at_src and t.resolved_at_src and t.resolved_at_src >= t.started_at_src:
                    member_cycle.setdefault(assignee_mid, []).append(
                        (t.resolved_at_src - t.started_at_src).total_seconds() / 86400.0
                    )
            elif t.status_category == StatusCategory.in_progress:
                mr.tasks_in_progress += 1
            else:
                mr.tasks_todo += 1
            mr.tasks.append(
                TaskItem(
                    key=t.external_key,
                    title=t.title,
                    issue_type=t.issue_type,
                    status=t.status,
                    status_category=t.status_category.value,
                    story_points=t.story_points,
                    hours=_hours(t.worklog_seconds),
                )
            )

    # ---- git contribution aggregation -------------------------------------
    window = sc.window
    _aggregate_git(db, project_id, window, members, member_names, summary)

    # ---- delivery-flow timings --------------------------------------------
    flow = _flow_metrics(db, project_id, tasks, window)

    # round accumulated floats
    summary.total_hours = round(summary.total_hours, 1)
    summary.assigned_sp = round(summary.assigned_sp, 1)
    summary.completed_sp = round(summary.completed_sp, 1)
    for mr in members.values():
        mr.hours = round(mr.hours, 1)
        mr.assigned_sp = round(mr.assigned_sp, 1)
        mr.completed_sp = round(mr.completed_sp, 1)
        if member_lead.get(mr.member_id):
            mr.lead_median_days = round(statistics.median(member_lead[mr.member_id]), 1)
        if member_cycle.get(mr.member_id):
            mr.cycle_median_days = round(statistics.median(member_cycle[mr.member_id]), 1)
    summary.num_members = len(members)

    deliverables = _scope_deliverables(db, project_id, sc.deliverable_sprint_ids)

    # closing-review breakdowns only make sense for whole-project scope
    sprint_rows: list[SprintBreakdownRow] = []
    type_rows: list[TypeBreakdownRow] = []
    p_start = p_end = None
    duration_days = None
    num_sprints = 0
    scope_baseline_sp = scope_added_sp = 0.0
    scope_added_tasks = 0
    if not sc.is_single_sprint:
        sprint_rows, type_rows, p_start, p_end, num_sprints = _project_breakdowns(sc.sprints, tasks)
        # prefer explicit date-range window for the timeline/duration
        w_start, w_end = window
        p_start = w_start or p_start
        p_end = w_end or p_end
        if p_start and p_end:
            duration_days = (p_end - p_start).days
        # Scope boundary = end of the first sprint (initial scope is what existed
        # through sprint 1; anything created later counts as scope added mid-project).
        boundary = None
        if sprint_rows:
            first = sprint_rows[0]
            boundary = first.end_date or first.start_date
        if boundary:
            for t in tasks:
                sp = t.story_points or 0
                if t.created_at_src and t.created_at_src.date() > boundary:
                    scope_added_sp += sp
                    scope_added_tasks += 1
                else:
                    scope_baseline_sp += sp
            scope_baseline_sp = round(scope_baseline_sp, 1)
            scope_added_sp = round(scope_added_sp, 1)

    title = f"{project.name} — {sc.title}"
    return ReportContext(
        title=title,
        report_type=report_type,
        scope_label=sc.scope_label,
        generated_at=datetime.now(timezone.utc),
        project=ProjectInfo(name=project.name, key=project.key, description=project.description),
        sprint=(
            SprintInfo(
                name=sprint.name,
                state=sprint.state,
                start_date=sprint.start_date,
                end_date=sprint.end_date,
                goal=sprint.goal,
            )
            if sprint
            else None
        ),
        summary=summary,
        members=sorted(members.values(), key=lambda m: m.completed_sp, reverse=True),
        deliverables=deliverables,
        data_quality=dq,
        flow=flow,
        sprint_breakdown=sprint_rows,
        type_breakdown=type_rows,
        project_start=p_start,
        project_end=p_end,
        duration_days=duration_days,
        num_sprints=num_sprints,
        scope_baseline_sp=scope_baseline_sp,
        scope_added_sp=scope_added_sp,
        scope_added_tasks=scope_added_tasks,
    )


# --------------------------------------------------------------------- helpers

def _member_lookup(db: Session) -> dict[int, Member]:
    return {m.id: m for m in db.execute(select(Member)).scalars()}


def _member(
    members: dict[int, MemberReport], member_id: int, names: dict[int, Member]
) -> MemberReport:
    if member_id not in members:
        m = names.get(member_id)
        members[member_id] = MemberReport(
            member_id=member_id,
            name=m.display_name if m else f"Member {member_id}",
            email=m.primary_email if m else None,
        )
    return members[member_id]


def _repo_ids(db: Session, project_id: int) -> list[int]:
    return list(
        db.execute(select(GitRepo.id).where(GitRepo.project_id == project_id)).scalars()
    )


def _aggregate_git(db, project_id, window, members, names, summary: ReportSummary) -> None:
    repo_ids = _repo_ids(db, project_id)
    if not repo_ids:
        return
    start, end = window

    commit_stmt = (
        select(Commit)
        .where(Commit.repo_id.in_(repo_ids))
        .where(Commit.is_merge.is_(False))
    )
    if start:
        commit_stmt = commit_stmt.where(Commit.authored_at >= _as_dt(start))
    if end:
        commit_stmt = commit_stmt.where(Commit.authored_at <= _as_dt(end, end_of_day=True))
    for c in db.execute(commit_stmt).scalars():
        summary.num_commits += 1
        mid = c.author.member_id if c.author else None
        if mid:
            mr = _member(members, mid, names)
            mr.commits += 1
            mr.additions += c.additions or 0
            mr.deletions += c.deletions or 0

    pr_stmt = select(PullRequest).where(PullRequest.repo_id.in_(repo_ids))
    if start:
        pr_stmt = pr_stmt.where(PullRequest.created_at_src >= _as_dt(start))
    if end:
        pr_stmt = pr_stmt.where(PullRequest.created_at_src <= _as_dt(end, end_of_day=True))
    for pr in db.execute(pr_stmt).scalars():
        summary.num_prs += 1
        mid = pr.author.member_id if pr.author else None
        if mid:
            mr = _member(members, mid, names)
            mr.prs_opened += 1
            if pr.state == "merged":
                mr.prs_merged += 1

    review_stmt = (
        select(PRReview)
        .join(PullRequest, PRReview.pr_id == PullRequest.id)
        .where(PullRequest.repo_id.in_(repo_ids))
    )
    for rev in db.execute(review_stmt).scalars():
        mid = rev.reviewer.member_id if rev.reviewer else None
        if mid:
            mr = _member(members, mid, names)
            mr.reviews_given += 1


def _as_dt(d, end_of_day: bool = False) -> datetime:
    t = datetime.min.time().replace(hour=23, minute=59, second=59) if end_of_day else datetime.min.time()
    return datetime.combine(d, t, tzinfo=timezone.utc)


def _parse_date_str(v) -> date | None:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v))
    except ValueError:
        return None


def _resolve_scope(db: Session, project_id: int, scope: dict) -> SimpleNamespace:
    """Turn a scope dict into a task set, sprint set, git window, and labels."""
    ns = SimpleNamespace(
        tasks=[], sprints=[], single_sprint=None, is_single_sprint=False,
        window=(None, None), title="Project Closing Review", scope_label=None,
        deliverable_sprint_ids=None,
    )
    sprint_ids = list(scope.get("sprint_ids") or [])
    if scope.get("sprint_id"):  # legacy single-sprint scope
        sprint_ids = [scope["sprint_id"]]
    start = _parse_date_str(scope.get("start"))
    end = _parse_date_str(scope.get("end"))

    if sprint_ids:
        sprints = db.execute(
            select(Sprint)
            .where(Sprint.project_id == project_id, Sprint.id.in_(sprint_ids))
            .order_by(Sprint.start_date)
        ).scalars().all()
        ns.sprints = sprints
        ns.tasks = list(
            db.execute(
                select(Task).where(Task.project_id == project_id, Task.sprint_id.in_(sprint_ids))
            ).scalars()
        )
        starts = [s.start_date for s in sprints if s.start_date]
        ends = [s.end_date for s in sprints if s.end_date]
        ns.window = (min(starts) if starts else None, max(ends) if ends else None)
        ns.deliverable_sprint_ids = [s.id for s in sprints]
        if len(sprints) == 1:
            ns.is_single_sprint = True
            ns.single_sprint = sprints[0]
            ns.title = f"{sprints[0].name} Report"
        else:
            ns.title = f"{len(sprints)} Sprints Report"
            ns.scope_label = "Sprints: " + ", ".join(s.name for s in sprints)

    elif start or end:
        lo = start or date.min
        hi = end or date.max
        ns.tasks = list(
            db.execute(
                select(Task).where(
                    Task.project_id == project_id,
                    Task.updated_at_src.is_not(None),
                    Task.updated_at_src >= _as_dt(lo),
                    Task.updated_at_src <= _as_dt(hi, end_of_day=True),
                )
            ).scalars()
        )
        all_sprints = db.execute(
            select(Sprint).where(Sprint.project_id == project_id).order_by(Sprint.start_date)
        ).scalars().all()
        ns.sprints = [s for s in all_sprints if _sprint_overlaps(s, start, end)]
        ns.window = (start, end)
        ns.deliverable_sprint_ids = [s.id for s in ns.sprints]
        ns.title = f"{start or '…'} → {end or '…'} Report"
        ns.scope_label = f"Period: {start or '…'} → {end or '…'}"

    else:  # whole project
        ns.tasks = list(
            db.execute(select(Task).where(Task.project_id == project_id)).scalars()
        )
        ns.sprints = db.execute(
            select(Sprint).where(Sprint.project_id == project_id).order_by(Sprint.start_date)
        ).scalars().all()
        ns.window = (None, None)
    return ns


def _sprint_overlaps(s: Sprint, start: date | None, end: date | None) -> bool:
    if s.start_date is None and s.end_date is None:
        return False
    s_lo = s.start_date or s.end_date
    s_hi = s.end_date or s.start_date
    if start and s_hi and s_hi < start:
        return False
    if end and s_lo and s_lo > end:
        return False
    return True


def _flow_metrics(db: Session, project_id: int, tasks: list[Task], window) -> FlowMetrics:
    """Task lead time (created→resolved) and PR cycle time (opened→merged)."""
    fm = FlowMetrics()

    lead_days = [
        (t.resolved_at_src - t.created_at_src).total_seconds() / 86400.0
        for t in tasks
        if t.status_category == StatusCategory.done and t.created_at_src and t.resolved_at_src
        and t.resolved_at_src >= t.created_at_src
    ]
    if lead_days:
        fm.task_lead_avg_days = round(statistics.mean(lead_days), 1)
        fm.task_lead_median_days = round(statistics.median(lead_days), 1)
        fm.task_lead_count = len(lead_days)

    cycle_days = [
        (t.resolved_at_src - t.started_at_src).total_seconds() / 86400.0
        for t in tasks
        if t.status_category == StatusCategory.done and t.started_at_src and t.resolved_at_src
        and t.resolved_at_src >= t.started_at_src
    ]
    if cycle_days:
        fm.task_cycle_avg_days = round(statistics.mean(cycle_days), 1)
        fm.task_cycle_median_days = round(statistics.median(cycle_days), 1)
        fm.task_cycle_count = len(cycle_days)

    repo_ids = _repo_ids(db, project_id)
    if repo_ids:
        start, end = window
        stmt = select(PullRequest).where(
            PullRequest.repo_id.in_(repo_ids), PullRequest.merged_at_src.is_not(None)
        )
        if start:
            stmt = stmt.where(PullRequest.created_at_src >= _as_dt(start))
        if end:
            stmt = stmt.where(PullRequest.created_at_src <= _as_dt(end, end_of_day=True))
        cycle_hours = [
            (pr.merged_at_src - pr.created_at_src).total_seconds() / 3600.0
            for pr in db.execute(stmt).scalars()
            if pr.created_at_src and pr.merged_at_src and pr.merged_at_src >= pr.created_at_src
        ]
        if cycle_hours:
            fm.pr_cycle_avg_hours = round(statistics.mean(cycle_hours), 1)
            fm.pr_cycle_median_hours = round(statistics.median(cycle_hours), 1)
            fm.pr_cycle_count = len(cycle_hours)
    return fm


def _project_breakdowns(sprints: list[Sprint], tasks: list[Task]):
    """Sprint-by-sprint velocity + task-type breakdown for the closing review."""
    # aggregate task stats per sprint id and per issue type
    per_sprint: dict[int, dict] = {}
    per_type: dict[str, dict] = {}
    for t in tasks:
        done = t.status_category == StatusCategory.done
        sp = t.story_points or 0
        if t.sprint_id is not None:
            s = per_sprint.setdefault(t.sprint_id, {"planned": 0.0, "done": 0.0, "n": 0, "nd": 0})
            s["planned"] += sp
            s["n"] += 1
            if done:
                s["done"] += sp
                s["nd"] += 1
        key = t.issue_type or "Unspecified"
        ty = per_type.setdefault(key, {"count": 0, "sp": 0.0, "done": 0})
        ty["count"] += 1
        ty["sp"] += sp
        if done:
            ty["done"] += 1

    sprint_rows = [
        SprintBreakdownRow(
            name=s.name,
            state=s.state,
            start_date=s.start_date,
            end_date=s.end_date,
            planned_sp=round(per_sprint.get(s.id, {}).get("planned", 0.0), 1),
            completed_sp=round(per_sprint.get(s.id, {}).get("done", 0.0), 1),
            tasks_total=per_sprint.get(s.id, {}).get("n", 0),
            tasks_done=per_sprint.get(s.id, {}).get("nd", 0),
        )
        for s in sprints
    ]
    type_rows = [
        TypeBreakdownRow(issue_type=k, count=v["count"], sp=round(v["sp"], 1), done=v["done"])
        for k, v in sorted(per_type.items(), key=lambda kv: kv[1]["count"], reverse=True)
    ]

    starts = [s.start_date for s in sprints if s.start_date]
    ends = [s.complete_date or s.end_date for s in sprints if (s.complete_date or s.end_date)]
    p_start = min(starts) if starts else None
    p_end = max(ends) if ends else None
    return sprint_rows, type_rows, p_start, p_end, len(sprints)


def _scope_deliverables(
    db: Session, project_id: int, sprint_ids: list[int] | None
) -> list[DeliverableItem]:
    stmt = select(Deliverable).where(Deliverable.project_id == project_id)
    if sprint_ids:
        stmt = stmt.where(
            Deliverable.sprint_id.in_(sprint_ids) | (Deliverable.sprint_id.is_(None))
        )
    rows = db.execute(stmt).scalars()
    return [
        DeliverableItem(
            name=d.name,
            description=d.description,
            status=d.status,
            linked_task_keys=d.linked_task_keys or [],
        )
        for d in rows
    ]
