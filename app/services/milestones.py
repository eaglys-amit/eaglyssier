"""Milestones: CRUD, the leaf-only rollup, and the roadmap payload.

A milestone stores a name and two dates. Everything else the Roadmap and List
views show is derived here on read, from the tasks pointing at it:

* **Progress** is a story-point rollup over *leaves only*. An epic and its
  subtasks both carry points, so an unfiltered SUM counts the tree twice — see
  invariant #1 in app.services.tasks. This is the single easiest way to make
  the whole feature quietly wrong.
* **The sprints a milestone spans** are the distinct sprints of those same leaf
  tasks. Deriving rather than storing them means dragging a task to another
  sprint on the board updates the roadmap with no second write, and the two
  views can never disagree.
* **The forecast** reuses build_velocity() — the number already behind the
  Scrums charts — so the roadmap and the velocity bars can't tell different
  stories about the same team.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Milestone, Sprint, StatusCategory, Task
from app.schemas.milestone import (
    GeneratedMilestone,
    GeneratedTaskRef,
    GenerateOut,
    GeneratePreviewOut,
    MilestoneCreateIn,
    MilestoneOut,
    MilestonePatchIn,
    MilestoneSprintRef,
    RoadmapOut,
    RoadmapSprintBand,
)
from app.schemas.scrum import VelocityOut
from app.services import burndown as burndown_svc
from app.services import tasks as tasks_svc

# Fallback sprint length when no sprint has both dates. Two weeks is the
# cadence the rest of the app assumes (see capacity.business_days).
DEFAULT_SPRINT_DAYS = 14

VALID_STATES = ("planned", "in_progress", "released", "cancelled")


# ------------------------------------------------------------------ lookups

def get_milestone(db: Session, project_id: int, milestone_id: int) -> Milestone:
    """Fetch one, scoped to the project. Mirrors scrum_svc.get_sprint."""
    milestone = db.get(Milestone, milestone_id)
    if milestone is None or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found")
    return milestone


def list_milestones(db: Session, project_id: int) -> list[Milestone]:
    """Roadmap order: by target date, undated last, then by hand-set rank."""
    return list(
        db.execute(
            select(Milestone)
            .where(Milestone.project_id == project_id)
            .order_by(Milestone.target_date.asc().nullslast(), Milestone.rank, Milestone.id)
        ).scalars().all()
    )


def _leaf_tasks(db: Session, milestone_id: int) -> list[Task]:
    """The milestone's leaf tasks. Leaves only — see the module docstring."""
    return list(
        db.execute(
            tasks_svc.leaf_only(select(Task).where(Task.milestone_id == milestone_id))
        ).scalars().all()
    )


def milestone_tasks(db: Session, milestone_id: int) -> list[Task]:
    """Every task linked to the milestone, leaves *and* containers.

    The sheet lists what a person actually attached, so it must not hide an
    epic just because its points are counted through its children.
    """
    return list(
        db.execute(
            select(Task)
            .where(Task.milestone_id == milestone_id)
            .order_by(Task.sprint_id.asc().nullslast(), Task.rank, Task.id)
        ).scalars().all()
    )


# -------------------------------------------------------------------- write

def _validate_state(state: str | None) -> None:
    if state is not None and state not in VALID_STATES:
        raise HTTPException(422, f"Unknown milestone state: {state!r}")


def _validate_dates(start: date | None, target: date | None) -> None:
    if start and target and target < start:
        raise HTTPException(422, "The target date can't fall before the start date")


def create_milestone(db: Session, project_id: int, data: MilestoneCreateIn) -> Milestone:
    _validate_state(data.state)
    _validate_dates(data.start_date, data.target_date)

    highest = db.execute(
        select(Milestone.rank).where(Milestone.project_id == project_id)
        .order_by(Milestone.rank.desc()).limit(1)
    ).scalar()

    milestone = Milestone(
        project_id=project_id,
        name=data.name.strip(),
        description=data.description,
        start_date=data.start_date,
        target_date=data.target_date,
        state=data.state,
        rank=int(highest or 0) + tasks_svc.RANK_STEP,
    )
    db.add(milestone)
    db.commit()
    db.refresh(milestone)
    return milestone


def patch_milestone(db: Session, milestone: Milestone, data: MilestonePatchIn) -> Milestone:
    """Partial edit; omitted fields are left alone (see backlog.patch_task)."""
    fields = data.model_dump(exclude_unset=True)
    _validate_state(fields.get("state"))
    _validate_dates(
        fields.get("start_date", milestone.start_date),
        fields.get("target_date", milestone.target_date),
    )
    if "name" in fields and fields["name"] is not None:
        fields["name"] = fields["name"].strip()
    # Releasing without naming the day stamps it, so the roadmap can stop
    # forecasting a milestone that has already shipped.
    if fields.get("state") == "released" and milestone.released_date is None:
        fields.setdefault("released_date", date.today())

    for key, value in fields.items():
        setattr(milestone, key, value)

    db.commit()
    db.refresh(milestone)
    return milestone


def delete_milestone(db: Session, milestone: Milestone) -> None:
    """Delete it; linked tasks survive with milestone_id NULL (ON DELETE SET NULL)."""
    db.delete(milestone)
    db.commit()


def assign_tasks(db: Session, milestone: Milestone, task_ids: list[int]) -> list[Task]:
    """Link tasks to the milestone. Rejects anything from another project."""
    if not task_ids:
        return []
    tasks = list(
        db.execute(select(Task).where(Task.id.in_(task_ids))).scalars().all()
    )
    found = {t.id for t in tasks}
    missing = [i for i in task_ids if i not in found]
    if missing:
        raise HTTPException(404, f"Task(s) not found: {missing}")
    for task in tasks:
        if task.project_id != milestone.project_id:
            raise HTTPException(400, "A task from another project can't join this milestone")
        task.milestone_id = milestone.id
    db.commit()
    return tasks


def unassign_task(db: Session, milestone: Milestone, task_id: int) -> None:
    """Tolerant unlink: a task already off the milestone is a no-op, not a 404."""
    task = db.get(Task, task_id)
    if task is None or task.milestone_id != milestone.id:
        return
    task.milestone_id = None
    db.commit()


# ------------------------------------------------------------------ rollup

def _sprint_length_days(sprints: list[Sprint]) -> int:
    """Median span of the sprints that have both dates — the forecast's step.

    Median rather than mean: one mis-dated sprint shouldn't stretch every
    forecast on the roadmap.
    """
    spans = sorted(
        (s.end_date - s.start_date).days
        for s in sprints
        if s.start_date and s.end_date and s.end_date >= s.start_date
    )
    if not spans:
        return DEFAULT_SPRINT_DAYS
    mid = len(spans) // 2
    median = spans[mid] if len(spans) % 2 else (spans[mid - 1] + spans[mid]) // 2
    return max(1, median)


def _forecast(
    remaining_points: float, rate: float, sprint_days: int, today: date
) -> date | None:
    """When the remaining points land, at the observed points-per-sprint rate.

    None when there is no rate to project from — an honest blank beats a
    number invented from a zero velocity.
    """
    if remaining_points <= 0 or rate <= 0:
        return None
    sprints_needed = math.ceil(remaining_points / rate)
    return today + timedelta(days=sprints_needed * sprint_days)


def _health(
    *,
    target_date: date | None,
    forecast_date: date | None,
    total_points: float,
    total_tasks: int,
    completed_tasks: int,
    state: str,
    today: date,
) -> str:
    """The badge on the bar. `unknown` wherever the data can't support a claim.

    Deliberately conservative: an empty or wholly unestimated milestone reads
    as `unknown`, not `on_track`. "On track" with nothing to track is the kind
    of green that gets believed.
    """
    if state == "released" or (total_tasks and completed_tasks == total_tasks):
        return "complete"
    if state == "cancelled":
        return "unknown"
    if target_date is None:
        return "unknown"
    if target_date < today:
        return "overdue"
    if not total_tasks or total_points <= 0:
        # Nothing linked, or nothing estimated — no basis for a verdict.
        return "unknown"
    if forecast_date is None:
        # Estimated work remains but velocity is zero: nothing to project from.
        return "unknown"
    return "at_risk" if forecast_date > target_date else "on_track"


def build_milestone(
    db: Session,
    milestone: Milestone,
    *,
    velocity: VelocityOut,
    sprint_by_id: dict[int, Sprint],
    sprint_days: int,
    today: date,
) -> MilestoneOut:
    """One milestone with its rollup, derived sprints, and forecast.

    Takes the velocity and sprint map from the caller so a roadmap of twenty
    milestones runs build_velocity once, not twenty times.
    """
    leaves = _leaf_tasks(db, milestone.id)
    total_points = round(sum(t.story_points or 0.0 for t in leaves), 1)
    completed_points = round(
        sum(
            t.story_points or 0.0
            for t in leaves
            if t.status_category == StatusCategory.done
        ),
        1,
    )
    remaining_points = round(total_points - completed_points, 1)
    total_tasks = len(leaves)
    completed_tasks = sum(1 for t in leaves if t.status_category == StatusCategory.done)
    unestimated = sum(1 for t in leaves if t.story_points is None)

    # Points where there are points; otherwise fall back to the task count, so
    # a milestone of unestimated work still shows movement instead of a flat 0.
    if total_points > 0:
        progress = completed_points / total_points
    elif total_tasks:
        progress = completed_tasks / total_tasks
    else:
        progress = 0.0

    # Derived sprints, over the same leaf set so the per-sprint points add up
    # to total_points. Backlog work (sprint_id NULL) has no band to sit on.
    points_by_sprint: dict[int, float] = {}
    for task in leaves:
        if task.sprint_id is None:
            continue
        points_by_sprint[task.sprint_id] = (
            points_by_sprint.get(task.sprint_id, 0.0) + (task.story_points or 0.0)
        )
    sprints = [
        MilestoneSprintRef(
            sprint_id=sprint.id,
            name=sprint.name,
            state=sprint.state,
            start_date=sprint.start_date,
            end_date=sprint.end_date,
            points_in_milestone=round(points, 1),
        )
        for sprint_id, points in points_by_sprint.items()
        if (sprint := sprint_by_id.get(sprint_id)) is not None
    ]
    sprints.sort(key=lambda s: (s.start_date or date.max, s.sprint_id))

    # A bar needs a left edge: fall back to the earliest sprint the work sits in.
    start_date = milestone.start_date
    if start_date is None:
        starts = [s.start_date for s in sprints if s.start_date]
        start_date = min(starts) if starts else None

    rate = velocity.rolling3 or velocity.average
    forecast_date = _forecast(remaining_points, rate, sprint_days, today)
    days_late = (
        (forecast_date - milestone.target_date).days
        if forecast_date and milestone.target_date
        else None
    )

    return MilestoneOut(
        id=milestone.id,
        project_id=milestone.project_id,
        name=milestone.name,
        description=milestone.description,
        start_date=start_date,
        target_date=milestone.target_date,
        state=milestone.state,
        rank=milestone.rank,
        total_points=total_points,
        completed_points=completed_points,
        remaining_points=remaining_points,
        total_tasks=total_tasks,
        completed_tasks=completed_tasks,
        unestimated_tasks=unestimated,
        progress=round(progress, 4),
        sprints=sprints,
        forecast_date=forecast_date,
        days_late=days_late,
        health=_health(
            target_date=milestone.target_date,
            forecast_date=forecast_date,
            total_points=total_points,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            state=milestone.state,
            today=today,
        ),
    )


def build_milestones(db: Session, project_id: int) -> list[MilestoneOut]:
    """Every milestone with its rollup — the List view's payload."""
    return build_roadmap(db, project_id).milestones


# --------------------------------------------------- generate from sprints

def _plan_from_epics(db: Session, project_id: int) -> list[GeneratedMilestone]:
    """Propose one milestone per top-level epic, dated from its sprints.

    The single source of truth for both the preview and the apply, so the dry
    run can't promise something the write then does differently.

    An "epic" here is structural, not a label: a task with no parent that has
    children. `issue_type` is free text a connector supplies, and keying off it
    would miss every locally-planned tree.

    Already-linked tasks are reported and left alone. That makes the generator
    re-runnable — run it again after a breakdown adds subtasks and it tops up
    the milestone instead of reshuffling hand-made links.
    """
    tasks = list(
        db.execute(select(Task).where(Task.project_id == project_id)).scalars().all()
    )
    if not tasks:
        return []

    children: dict[int, list[Task]] = {}
    for task in tasks:
        if task.parent_id is not None:
            children.setdefault(task.parent_id, []).append(task)

    sprint_by_id = {
        s.id: s
        for s in db.execute(
            select(Sprint).where(Sprint.project_id == project_id)
        ).scalars().all()
    }
    milestone_by_id = {
        m.id: m for m in db.execute(
            select(Milestone).where(Milestone.project_id == project_id)
        ).scalars().all()
    }
    # A name already on the board means a previous run made this milestone, so
    # the epic tops it up instead of duplicating it.
    milestone_id_by_name = {m.name.strip().lower(): m.id for m in milestone_by_id.values()}
    # Names claimed by *this* plan. Two distinct epics sharing a title can't
    # both create, and they must not silently merge either — the second is a
    # genuine conflict for a person to resolve by renaming one.
    claimed_in_run: set[str] = set()

    epics = [t for t in tasks if t.parent_id is None and children.get(t.id)]
    epics.sort(key=lambda t: (t.rank, t.id))

    proposals: list[GeneratedMilestone] = []
    for epic in epics:
        # Walk the subtree from the in-memory map rather than re-querying per
        # epic; trees are capped at three levels so this stays trivial.
        leaves: list[Task] = []
        frontier = list(children.get(epic.id, []))
        seen = {epic.id}
        while frontier:
            node = frontier.pop()
            if node.id in seen:
                continue  # defensive: a cycle would otherwise loop forever
            seen.add(node.id)
            kids = children.get(node.id)
            if kids:
                frontier.extend(kids)
            else:
                leaves.append(node)
        leaves.sort(key=lambda t: (t.rank, t.id))

        refs: list[GeneratedTaskRef] = []
        sprint_ids: set[int] = set()
        link_points = 0.0
        link_count = skip_count = 0
        for leaf in leaves:
            sprint = sprint_by_id.get(leaf.sprint_id) if leaf.sprint_id else None
            taken = leaf.milestone_id is not None
            if taken:
                skip_count += 1
            else:
                link_count += 1
                link_points += leaf.story_points or 0.0
                if sprint is not None:
                    # Dates come from the sprints of the work we'd actually
                    # claim — a skipped task's sprint isn't this milestone's.
                    sprint_ids.add(sprint.id)
            refs.append(
                GeneratedTaskRef(
                    task_id=leaf.id,
                    key=tasks_svc.task_label(leaf),
                    title=leaf.title,
                    story_points=leaf.story_points,
                    sprint_name=sprint.name if sprint else None,
                    action="skip" if taken else "link",
                    held_by=(
                        milestone_by_id[leaf.milestone_id].name
                        if taken and leaf.milestone_id in milestone_by_id
                        else None
                    ),
                )
            )

        spans = [sprint_by_id[i] for i in sprint_ids]
        starts = [s.start_date for s in spans if s.start_date]
        ends = [s.end_date for s in spans if s.end_date]

        name = (epic.title or tasks_svc.task_label(epic)).strip()
        key = name.lower()
        existing_id = milestone_id_by_name.get(key)
        mode = "top_up" if existing_id is not None else "create"

        conflict: str | None = None
        if not link_count:
            conflict = (
                "Every task under this epic is already on its milestone"
                if skip_count
                else "This epic has no leaf tasks to link"
            )
        elif key in claimed_in_run:
            conflict = (
                f"Another epic in this project is also called {name!r} — "
                "rename one of them first"
            )
        else:
            claimed_in_run.add(key)

        proposals.append(
            GeneratedMilestone(
                source_task_id=epic.id,
                source_key=tasks_svc.task_label(epic),
                name=name,
                start_date=min(starts) if starts else None,
                target_date=max(ends) if ends else None,
                sprint_names=[
                    s.name for s in sorted(spans, key=lambda x: (x.start_date or date.max, x.id))
                ],
                tasks=refs,
                link_count=link_count,
                skip_count=skip_count,
                total_points=round(link_points, 1),
                mode=mode,
                existing_milestone_id=existing_id,
                conflict=conflict,
            )
        )

    return proposals


def preview_generated(db: Session, project_id: int) -> GeneratePreviewOut:
    """Dry run: what generating would create, without writing anything."""
    proposals = _plan_from_epics(db, project_id)
    ready = [p for p in proposals if p.conflict is None]
    return GeneratePreviewOut(
        strategy="epic",
        proposals=proposals,
        ready_count=len(ready),
        create_count=sum(1 for p in ready if p.mode == "create"),
        top_up_count=sum(1 for p in ready if p.mode == "top_up"),
        total_link_count=sum(p.link_count for p in ready),
        total_skip_count=sum(p.skip_count for p in proposals),
    )


def generate_from_sprints(
    db: Session, project_id: int, source_task_ids: list[int] | None = None
) -> GenerateOut:
    """Apply the plan: a milestone per epic, linking the leaves nothing else holds.

    `source_task_ids` narrows it to the proposals the user ticked in the
    preview; None means every ready one. Proposals carrying a conflict are
    never applied, whether or not they were named.

    Safe to re-run. An epic whose milestone already exists tops that milestone
    up with newly-added leaves rather than creating a second one, and work
    already on some other milestone is counted and left where it is.
    """
    proposals = _plan_from_epics(db, project_id)
    wanted = set(source_task_ids) if source_task_ids is not None else None

    touched_ids: list[int] = []
    created = updated = linked = skipped = 0
    highest = db.execute(
        select(Milestone.rank).where(Milestone.project_id == project_id)
        .order_by(Milestone.rank.desc()).limit(1)
    ).scalar()
    rank = int(highest or 0)

    for proposal in proposals:
        skipped += proposal.skip_count
        if proposal.conflict is not None:
            continue
        if wanted is not None and proposal.source_task_id not in wanted:
            continue

        if proposal.mode == "top_up":
            milestone = db.get(Milestone, proposal.existing_milestone_id or 0)
            if milestone is None or milestone.project_id != project_id:
                continue  # deleted between the plan and here; nothing to extend
            updated += 1
            # Its dates are the user's now — a top-up adds work, not opinions.
        else:
            rank += tasks_svc.RANK_STEP
            milestone = Milestone(
                project_id=project_id,
                name=proposal.name,
                description=f"Generated from epic {proposal.source_key}.",
                start_date=proposal.start_date,
                target_date=proposal.target_date,
                state="planned",
                rank=rank,
            )
            db.add(milestone)
            db.flush()  # need the id before linking
            created += 1

        for ref in proposal.tasks:
            if ref.action != "link":
                continue
            task = db.get(Task, ref.task_id)
            # Re-check in this transaction: the plan was computed a moment ago
            # and something else may have claimed the task since.
            if task is None or task.milestone_id is not None:
                continue
            task.milestone_id = milestone.id
            linked += 1

        touched_ids.append(milestone.id)

    db.commit()

    if not touched_ids:
        return GenerateOut(created=0, updated=0, linked=0, skipped=skipped, milestones=[])

    touched = set(touched_ids)
    roadmap = build_roadmap(db, project_id)
    return GenerateOut(
        created=created,
        updated=updated,
        linked=linked,
        skipped=skipped,
        milestones=[m for m in roadmap.milestones if m.id in touched],
    )


def build_roadmap(db: Session, project_id: int) -> RoadmapOut:
    """The whole canvas in one fetch: milestones, sprint bands, and the domain."""
    today = date.today()
    project_sprints = list(
        db.execute(
            select(Sprint)
            .where(Sprint.project_id == project_id)
            .order_by(Sprint.start_date.asc().nullslast(), Sprint.id)
        ).scalars().all()
    )
    sprint_by_id = {s.id: s for s in project_sprints}
    sprint_days = _sprint_length_days(project_sprints)
    # Once for the whole roadmap, not once per milestone.
    velocity = burndown_svc.build_velocity(db, project_id)

    milestones = [
        build_milestone(
            db,
            m,
            velocity=velocity,
            sprint_by_id=sprint_by_id,
            sprint_days=sprint_days,
            today=today,
        )
        for m in list_milestones(db, project_id)
    ]

    bands = [
        RoadmapSprintBand(
            sprint_id=s.id,
            name=s.name,
            state=s.state,
            start_date=s.start_date,
            end_date=s.end_date,
        )
        for s in project_sprints
        if s.start_date and s.end_date
    ]

    # Domain covers everything plotted, and always today — an empty roadmap
    # still needs an axis to hang the "today" rule on. Target and forecast
    # dates go into *both* lists: an overdue milestone with no start date has
    # its only mark in the past, and it must not fall off the left edge.
    starts = [today]
    ends = [today]
    for m in milestones:
        if m.start_date:
            starts.append(m.start_date)
        for candidate in (m.target_date, m.forecast_date):
            if candidate:
                starts.append(candidate)
                ends.append(candidate)
    for b in bands:
        starts.append(b.start_date)
        ends.append(b.end_date)

    return RoadmapOut(
        milestones=milestones,
        sprints=bands,
        range_start=min(starts),
        range_end=max(ends),
        velocity_rolling3=velocity.rolling3,
        velocity_average=velocity.average,
        sprint_length_days=sprint_days,
    )
