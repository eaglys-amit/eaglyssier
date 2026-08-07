"""Assemble the Gantt-chart model: per-member swimlanes of Jira tasks + commits.

Jira tasks become timeline bars grouped by the assignee's curated Member. Git
commits are attributed to a Jira task by the LLM linker (see
app.services.commit_link), which persists ``Commit.linked_task_id``; attributed
commits render as markers on that task's bar. Commits with no link are returned
in ``unassigned`` as the work list the UI runs attribution against.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from datetime import timedelta

from app.models import Commit, GitRepo, MemberIdentity, Sprint, Task
from app.schemas.data import GanttCommit, GanttItem, GanttOut, GanttRow, GanttSprint
from app.services import tasks as tasks_svc


def _aware(value: datetime | date | None) -> datetime | None:
    """Coerce a date/naive-datetime to a UTC-aware datetime for safe comparison."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


def _summary(commit: Commit) -> str | None:
    """LLM analysis summary if present, else the first line of the commit message."""
    analysis = commit.analysis if isinstance(commit.analysis, dict) else {}
    summary = analysis.get("summary")
    if summary:
        return summary
    if commit.message:
        first = commit.message.strip().splitlines()
        if first:
            return first[0][:120]
    return None


def _identity_name(ident: MemberIdentity | None) -> str | None:
    if ident is None:
        return None
    return ident.display_name or ident.username or ident.email


def _gantt_commit(c: Commit) -> GanttCommit:
    return GanttCommit(
        id=c.id,
        sha=c.sha,
        authored_at=c.authored_at,
        summary=_summary(c),
        additions=c.additions,
        deletions=c.deletions,
        author_name=_identity_name(c.author),
        repo_name=c.repo.name if c.repo else None,
        link_status=c.link_status,
    )


def build_gantt(db: Session, project_id: int) -> GanttOut:
    sprints = {
        s.id: s
        for s in db.execute(
            select(Sprint).where(Sprint.project_id == project_id)
        ).scalars()
    }

    tasks = db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .options(selectinload(Task.assignee).selectinload(MemberIdentity.member))
    ).scalars().all()

    commits = db.execute(
        select(Commit)
        .join(GitRepo)
        .where(GitRepo.project_id == project_id, Commit.is_merge.is_(False))
        .options(
            selectinload(Commit.author).selectinload(MemberIdentity.member),
            selectinload(Commit.repo),
        )
    ).scalars().all()

    # Curated display names for mapped members; unmapped identities -> Unassigned.
    member_names: dict[int, str] = {}
    for ident in [t.assignee for t in tasks] + [c.author for c in commits]:
        if ident and ident.member_id and ident.member:
            member_names[ident.member_id] = ident.member.display_name

    # Sort each commit by its attribution outcome:
    #   linked          -> markers on the matched task's bar
    #   ready, no match -> a commit item in the author's swimlane (badge = sha)
    #   otherwise       -> the "needs attribution" work list (panel)
    attached: dict[int, list[Commit]] = defaultdict(list)
    unmatched_by_member: dict[int | None, list[Commit]] = defaultdict(list)
    panel: list[Commit] = []
    for c in commits:
        if c.linked_task_id is not None:
            attached[c.linked_task_id].append(c)
        elif c.link_status == "ready" and c.authored_at is not None:
            member_id = c.author.member_id if c.author else None
            unmatched_by_member[member_id].append(c)
        else:
            panel.append(c)

    # A container and its subtasks would draw the same work twice in one
    # swimlane, so only leaves get bars. GanttItem.parent_id still carries the
    # link for a future nested rendering.
    container_ids = {t.parent_id for t in tasks if t.parent_id is not None}

    items_by_member: dict[int | None, list[GanttItem]] = defaultdict(list)
    for t in tasks:
        if t.id in container_ids:
            continue
        sprint = sprints.get(t.sprint_id)
        start = (
            _aware(t.started_at_src)
            or _aware(t.created_at_src)
            or (_aware(sprint.start_date) if sprint else None)
            # Last resort for a local task with no sprint and no connector
            # timestamps: the row's own created_at, which is always populated.
            or _aware(t.created_at)
        )
        end = (
            _aware(t.resolved_at_src)
            or _aware(t.updated_at_src)
            or (_aware(sprint.end_date) if sprint else None)
        )
        if start and not end:
            end = start
        if start is None:
            continue  # no placeable window -> can't draw a bar
        member_id = t.assignee.member_id if t.assignee else None
        cs = sorted(attached.get(t.id, []), key=lambda c: _aware(c.authored_at) or start)
        items_by_member[member_id].append(
            GanttItem(
                id=f"task-{t.id}",
                kind="jira",
                task_id=t.id,
                key=tasks_svc.task_label(t),
                parent_id=t.parent_id,
                title=t.title,
                status_category=t.status_category.value,
                start=start,
                end=end,
                story_points=t.story_points,
                commits=[_gantt_commit(c) for c in cs],
            )
        )

    # Analyzed-but-unmatched commits become point items in their author's lane.
    for member_id, cs in unmatched_by_member.items():
        for c in cs:
            at = _aware(c.authored_at)
            if at is None:
                continue
            items_by_member[member_id].append(
                GanttItem(
                    id=f"commit-{c.id}",
                    kind="commit",
                    task_id=None,
                    key=c.sha[:8],
                    title=_summary(c) or c.sha[:8],
                    status_category=None,
                    start=at,
                    end=at,
                    story_points=None,
                    commits=[_gantt_commit(c)],
                )
            )

    rows: list[GanttRow] = []
    named = sorted(
        (mid for mid in items_by_member if mid is not None),
        key=lambda mid: member_names.get(mid, "").lower(),
    )
    for mid in named:
        items = sorted(items_by_member[mid], key=lambda it: it.start)
        rows.append(
            GanttRow(member_id=mid, display_name=member_names.get(mid, f"Member {mid}"), items=items)
        )
    if None in items_by_member:
        items = sorted(items_by_member[None], key=lambda it: it.start)
        rows.append(GanttRow(member_id=None, display_name="Unassigned", items=items))

    unassigned_out = [
        _gantt_commit(c)
        for c in sorted(panel, key=lambda c: _aware(c.authored_at) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    ]

    # Sprints with a resolvable window, drawn as bands/boundary lines. The end
    # is pushed to the following midnight so the band covers the whole end day.
    sprint_bands: list[GanttSprint] = []
    for s in sprints.values():
        start = _aware(s.start_date)
        end = _aware(s.end_date)
        if start is None or end is None:
            continue
        sprint_bands.append(
            GanttSprint(
                id=s.id,
                name=s.name,
                state=s.state,
                start=start,
                end=end + timedelta(days=1),
            )
        )
    sprint_bands.sort(key=lambda b: b.start)

    # Range spans every dated element so the axis is stable as commits get linked.
    dated = [it.start for r in rows for it in r.items]
    dated += [it.end for r in rows for it in r.items]
    dated += [_aware(c.authored_at) for c in commits if c.authored_at]
    dated += [b.start for b in sprint_bands] + [b.end for b in sprint_bands]
    dated = [d for d in dated if d is not None]
    return GanttOut(
        rows=rows,
        sprints=sprint_bands,
        unassigned=unassigned_out,
        range_start=min(dated, default=None),
        range_end=max(dated, default=None),
    )
