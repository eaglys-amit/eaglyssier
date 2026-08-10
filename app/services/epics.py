"""Group flat tracker tasks into epics, using the numbering the team already uses.

Jira here is flat: 88 synced issues, all Task or Subtask, no Epic. But the
titles are not flat at all —

    PBR9-PBI2-ST1: Closed source strategy
    PBI 4: (Testing) Write Unit Tests for the Extractor

— the team has been encoding a three-level hierarchy in text for months. PBR is
the refinement round, PBI the backlog item, ST the story. That is a real
taxonomy, authored by the people doing the work, and it beats anything a model
would infer from the same titles.

So this reads the grouping out rather than inventing it, and every task it
cannot place is reported in `ungrouped` instead of being quietly dropped. A
generator that silently covers three quarters of a backlog looks broken, which
is exactly how the milestone generator looked before this existed.

Generated epics are ordinary local Tasks with `issue_type='Epic'`. Nothing here
is a new kind of row, so the board, the breakdown tree, capacity and the
milestone rollup all understand them already. `ungroup_epic` is the undo.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Milestone, Project, Sprint, StatusCategory, Task
from app.schemas.epic import (
    EpicGenerateOut,
    EpicMemberRef,
    EpicPreviewOut,
    EpicProposal,
    EpicUngroupOut,
)
from app.services import analyzers
from app.services import tasks as tasks_svc

log = logging.getLogger("app.services.epics")

# Marks an epic this service made, so ungroup knows what it may dismantle. The
# group key is stored alongside it because the title is user-editable and may
# no longer contain it — see the note in _plan.
GENERATED_MARK = "Generated from task numbering"
_MARK_KEY = re.compile(rf"{re.escape(GENERATED_MARK)}:\s*([A-Za-z0-9]+)")

# PBR<n>, tolerating "PBR-5" and "PBR 5". Searched anywhere in the title, not
# anchored: real titles put it mid-string too ("Build … PBR13-PBIX-Application").
_PBR = re.compile(r"\bPBR\s*-?\s*(\d+)", re.IGNORECASE)
# PBI<n> or the "PB1" typo that appears in the real data, plus the PBIX wildcard.
_PBI = re.compile(r"\bPB(?:I|1)\s*-?\s*(\d+|X)\b", re.IGNORECASE)

# Deepest tree the rest of the app expects: epic -> task -> subtask. A member
# that already has grandchildren would push past it once we add a level on top.
_MAX_DEPTH = 3

# Strips the numbering off the front of a title, leaving the human part:
# "PBR9-PBI2-ST1: Closed source strategy" -> "Closed source strategy".
_PREFIX = re.compile(r"^\s*(?:PB[RI1]?\s*-?\s*[\dX]+\s*[-:]?\s*)+(?:ST[X\d]*\s*)?[-:]?\s*", re.IGNORECASE)
_INLINE_TOKEN = re.compile(r"\bPB[RI1]?\s*-?\s*[\dX]+\b|\bST[X\d]+\b", re.IGNORECASE)
_PARENS = re.compile(r"\(.*?\)")

# Words that carry no signal when they appear in every second title. Generic
# engineering verbs plus the usual grammar; the project's own product name is
# added dynamically in _fallback_label, since "MiningAI" is in most titles here
# and would otherwise win every vote.
_STOPWORDS = frozenset(
    ["a", "an", "and", "or", "of", "for", "the", "to", "in", "on", "with", "from", "into", "via", "using", "our", "new", "all", "not", "add", "create", "build", "make", "update", "implement", "write", "set", "setup", "basic", "base", "based", "support", "new", "change", "changes", "fix", "work", "task", "story", "spike", "investigate"]
)


def strip_numbering(title: str) -> str:
    """The readable part of a task title, with the PBR/PBI/ST tokens removed."""
    s = _PREFIX.sub("", title or "")
    s = _INLINE_TOKEN.sub(" ", s)
    s = _PARENS.sub(" ", s)
    return re.sub(r"[\s:_·-]+", " ", s).strip(" -:·")


def _fallback_label(key: str, titles: list[str]) -> str:
    """A name derived from the member titles, for when no model is involved.

    Deliberately modest. Token frequency cannot summarise a theme, so this aims
    only to beat a bare "PBR 9" — it appends the two most distinctive words
    shared by the group and leaves the number in place so the tie back to the
    tracker survives.

    Words appearing in nearly every title across the *whole* project (the
    product name, typically) are dropped: they are true of every group and so
    distinguish none of them.
    """
    number = f"{key[:3]} {key[3:]}" if key[:3].upper() in ("PBR", "PBI") else key
    cleaned = [strip_numbering(t) for t in titles]
    words: Counter[str] = Counter()
    for text in cleaned:
        seen_here = {
            w
            for w in re.findall(r"[A-Za-z][\w/+.-]{2,}", text.lower())
            if w not in _STOPWORDS
        }
        words.update(seen_here)
    if not words:
        return number

    # A word in more than 70% of the group's titles is usually the product name
    # rather than the theme, unless the group is tiny.
    ceiling = max(2, int(len(cleaned) * 0.7))
    ranked = [w for w, n in words.most_common() if n <= ceiling] or [
        w for w, _ in words.most_common()
    ]
    picked = [w.title() for w in ranked[:2]]
    return f"{number} · {' '.join(picked)}" if picked else number


def parse_group(title: str) -> tuple[str, str] | None:
    """(kind, key) for a title, or None when it carries no recognisable token.

    PBR wins over PBI: it is the outer number, so ``PBR9-PBI2-ST1`` groups under
    PBR9. Pure, and the single place the convention is encoded — change it here
    and preview, apply and coverage all move together.
    """
    if not title:
        return None
    m = _PBR.search(title)
    if m:
        return ("pbr", f"PBR{int(m.group(1))}")
    p = _PBI.search(title)
    if p:
        token = p.group(1).upper()
        return ("pbi", f"PBI{int(token) if token.isdigit() else token}")
    return None


def _subtree_depth(children: dict[int, list[Task]], task_id: int, seen: set[int] | None = None) -> int:
    """Levels at and below `task_id` (a leaf is 1). Guards against cycles."""
    seen = seen or set()
    if task_id in seen:
        return 1
    seen.add(task_id)
    kids = children.get(task_id)
    if not kids:
        return 1
    return 1 + max(_subtree_depth(children, k.id, seen) for k in kids)


def _plan(db: Session, project_id: int) -> tuple[list[EpicProposal], list[EpicMemberRef], int]:
    """Proposals, the tasks that couldn't be placed, and how many needed placing.

    One function behind both the preview and the apply, so a dry run can't
    promise something the write then does differently.
    """
    tasks = list(
        db.execute(select(Task).where(Task.project_id == project_id)).scalars().all()
    )
    if not tasks:
        return [], [], 0

    children: dict[int, list[Task]] = {}
    for t in tasks:
        if t.parent_id is not None:
            children.setdefault(t.parent_id, []).append(t)

    sprint_by_id = {
        s.id: s
        for s in db.execute(
            select(Sprint).where(Sprint.project_id == project_id)
        ).scalars().all()
    }

    # Epics this service made on a previous run, keyed by their group token, so
    # a re-run tops them up instead of creating a second one.
    #
    # Keyed off the marker in the description, NOT the title: the whole point of
    # naming is that the title becomes "Closed-Source Packaging" with no PBR9 in
    # it, and parsing the title would then fail to recognise the epic and create
    # a duplicate on the next run.
    existing_by_key: dict[str, Task] = {}
    for t in tasks:
        if t.parent_id is not None:
            continue
        m = _MARK_KEY.match(t.description or "")
        if m:
            existing_by_key[m.group(1).upper()] = t

    # Only tasks that actually need a container: no parent, and not already one
    # themselves. Re-parenting an existing container would nest trees.
    container_ids = set(children.keys())
    generated_ids = {t.id for t in existing_by_key.values()}
    candidates = [
        t
        for t in tasks
        if t.parent_id is None and t.id not in container_ids and t.id not in generated_ids
    ]
    candidates.sort(key=lambda t: (t.rank, t.id))

    def member_ref(t: Task, action: str = "group", reason: str | None = None) -> EpicMemberRef:
        sprint = sprint_by_id.get(t.sprint_id) if t.sprint_id else None
        return EpicMemberRef(
            task_id=t.id,
            key=tasks_svc.task_label(t),
            title=t.title,
            story_points=t.story_points,
            sprint_name=sprint.name if sprint else None,
            source=t.source,
            action=action,
            reason=reason,
        )

    grouped: dict[str, list[Task]] = {}
    kinds: dict[str, str] = {}
    ungrouped: list[EpicMemberRef] = []
    for t in candidates:
        parsed = parse_group(t.title or "")
        if parsed is None:
            ungrouped.append(member_ref(t, "skip", "no PBR/PBI number in the title"))
            continue
        kind, key = parsed
        grouped.setdefault(key, []).append(t)
        kinds[key] = kind

    proposals: list[EpicProposal] = []
    for key, members in grouped.items():
        refs: list[EpicMemberRef] = []
        sprint_ids: set[int] = set()
        points = 0.0
        take = skip = 0
        for t in members:
            depth = _subtree_depth(children, t.id)
            if depth >= _MAX_DEPTH:
                # Adding an epic on top would make it 4 deep; the breakdown
                # tree and its UI assume 3.
                refs.append(
                    member_ref(t, "skip", "its own subtree is already three levels deep")
                )
                skip += 1
                continue
            refs.append(member_ref(t))
            take += 1
            points += t.story_points or 0.0
            if t.sprint_id:
                sprint_ids.add(t.sprint_id)

        spans = [sprint_by_id[i] for i in sprint_ids if i in sprint_by_id]
        starts = [s.start_date for s in spans if s.start_date]
        ends = [s.end_date for s in spans if s.end_date]

        existing = existing_by_key.get(key)
        kind = kinds[key]
        # Only the members we'd actually take vote on the name.
        label = _fallback_label(key, [t.title or "" for t in members])
        conflict = None if take else "Nothing left to group under this number"

        proposals.append(
            EpicProposal(
                group_key=key,
                name=existing.title if existing else label,
                kind=kind,
                members=refs,
                member_count=take,
                skip_count=skip,
                total_points=round(points, 1),
                sprint_names=[
                    s.name for s in sorted(spans, key=lambda x: (x.start_date or date.max, x.id))
                ],
                start_date=min(starts) if starts else None,
                end_date=max(ends) if ends else None,
                mode="top_up" if existing else "create",
                existing_task_id=existing.id if existing else None,
                conflict=conflict,
            )
        )

    # Chronological: the roadmap reads left to right, so the epic list should too.
    proposals.sort(
        key=lambda p: (
            p.start_date or date.max,
            0 if p.kind == "pbi" else 1,
            p.group_key,
        )
    )
    return proposals, ungrouped, len(candidates)


def preview_epics(db: Session, project_id: int) -> EpicPreviewOut:
    """Dry run, with the coverage number stated up front."""
    proposals, ungrouped, needs = _plan(db, project_id)
    ready = [p for p in proposals if p.conflict is None]
    placed = sum(p.member_count for p in proposals)
    return EpicPreviewOut(
        proposals=proposals,
        ready_count=len(ready),
        create_count=sum(1 for p in ready if p.mode == "create"),
        top_up_count=sum(1 for p in ready if p.mode == "top_up"),
        total_member_count=sum(p.member_count for p in ready),
        ungrouped=ungrouped,
        needs_group_count=needs,
        coverage_pct=round(100.0 * placed / needs, 1) if needs else 0.0,
    )


# Long enough to be a sentence fragment, short enough for a roadmap row.
_MAX_NAME = 60
# Enough of each group for a theme to be visible without pasting the backlog.
_TITLES_PER_GROUP = 12

_NAME_PROMPT = """\
You are naming epics for a software project's roadmap.

Each group below is a set of tasks that belong together. The grouping is already
decided and is NOT up for debate — your only job is to give each group a short,
human name that says what the work IS.

Rules:
- 2 to 6 words. Under {max_name} characters. Title case, no trailing period.
- Name the deliverable or capability, not the process. "Closed-source packaging"
  beats "Implementation work" and beats "PBR 9 tasks".
- Do NOT include the group key (PBR9, PBI2), a sprint name, or a date. Those are
  shown next to the name already.
- Do not invent scope that is not in the titles. If a group is genuinely mixed,
  name the largest coherent part rather than inventing an umbrella.
- Every key in the input must appear exactly once in the output.

Return ONLY a JSON object mapping each group key to its name:
{{"PBR9": "Closed-Source Packaging", "PBI1": "Extractor Library API"}}

Groups:
{groups}
"""


def nameable_groups(db: Session, project_id: int) -> list[tuple[str, str, list[str], int | None]]:
    """(group_key, current_name, member_titles, existing_task_id) for everything nameable.

    Covers both directions, because naming has to fix what is already on the
    board as well as what is about to be created:

    * groups not yet applied — titles come from the proposed members
    * epics a previous run created — titles come from their current children
    """
    out: list[tuple[str, str, list[str], int | None]] = []
    seen: set[str] = set()

    proposals, _ungrouped, _needs = _plan(db, project_id)
    for p in proposals:
        if p.conflict is not None:
            continue
        titles = [m.title for m in p.members if m.action == "group"]
        out.append((p.group_key, p.name, titles, p.existing_task_id))
        seen.add(p.group_key)

    # Epics already created. _plan only proposes for unparented candidates, so
    # once everything is grouped it returns nothing — these would otherwise be
    # unreachable, which is exactly the state a project lands in after one run.
    rows = db.execute(
        select(Task).where(Task.project_id == project_id, Task.parent_id.is_(None))
    ).scalars().all()
    for epic in rows:
        m = _MARK_KEY.match(epic.description or "")
        if not m or m.group(1).upper() in seen:
            continue
        kids = db.execute(
            select(Task.title).where(Task.parent_id == epic.id)
        ).scalars().all()
        if kids:
            out.append((m.group(1).upper(), epic.title, list(kids), epic.id))
    return out


def rename_epics(db: Session, project_id: int, names: dict[str, str]) -> int:
    """Retitle already-created epics by group key. Returns how many changed.

    Carries the rename through to any milestone generated from that epic. A
    milestone's name is a stored copy taken at generation time, not a live read
    of the epic — so without this, renaming "PBR 9" to something meaningful
    would fix the board and leave the roadmap still saying "PBR 9", which is
    the exact problem this feature exists to solve.

    Milestones whose name was edited by hand are left alone: the marker match
    tells us it was generated, but a name that no longer matches the epic's old
    title means somebody chose it deliberately.
    """
    if not names:
        return 0
    wanted = {k.upper(): v for k, v in names.items()}
    rows = db.execute(
        select(Task).where(Task.project_id == project_id, Task.parent_id.is_(None))
    ).scalars().all()

    milestones = db.execute(
        select(Milestone).where(Milestone.project_id == project_id)
    ).scalars().all()
    by_marker = {
        f"Generated from epic {tasks_svc.task_label(epic)}.": epic for epic in rows
    }

    changed = 0
    for epic in rows:
        m = _MARK_KEY.match(epic.description or "")
        if not m:
            continue
        title = (wanted.get(m.group(1).upper()) or "").strip()[:_MAX_NAME]
        if not title or title == epic.title:
            continue
        previous = epic.title
        epic.title = title
        changed += 1
        for milestone in milestones:
            if by_marker.get(milestone.description or "") is epic and milestone.name == previous:
                milestone.name = title
    if changed:
        db.commit()
    return changed


def suggest_names(db: Session, project_id: int) -> dict[str, str]:
    """Ask the project's analyzer to name each group from its task titles.

    Naming only. Membership stays deterministic, so a wrong or unavailable model
    costs a worse label — never a wrong grouping. Anything the model returns is
    clamped to length, stripped of the numbering it was told to omit, and
    dropped entirely if it names a key we did not ask about.
    """
    live = nameable_groups(db, project_id)
    if not live:
        return {}

    project = db.get(Project, project_id)
    provider = project.analysis_provider if project else None
    if not provider or not analyzers.is_available(provider):
        raise HTTPException(
            409,
            "No analysis provider is configured for this project, so names can't "
            "be suggested. Set one up on the Provider page, or edit the names by hand.",
        )

    blocks = []
    for key, _current, titles, _task_id in live:
        lines = [f"    - {strip_numbering(t)[:120]}" for t in titles][:_TITLES_PER_GROUP]
        blocks.append(f"  {key} ({len(titles)} tasks):\n" + "\n".join(lines))
    prompt = _NAME_PROMPT.format(max_name=_MAX_NAME, groups="\n\n".join(blocks))

    analyzer = analyzers.get_analyzer(
        provider, config={"model": project.analysis_model if project else None}
    )
    try:
        result = analyzer.analyze(prompt)
    except analyzers.AnalyzerError as exc:
        raise HTTPException(502, f"The model could not name these groups: {exc}") from None

    wanted = {key for key, _c, _t, _i in live}
    out: dict[str, str] = {}
    for key, value in (result.data or {}).items():
        if key not in wanted or not isinstance(value, str):
            continue  # a key we didn't ask about, or a non-string
        name = strip_numbering(value).strip().strip('"')
        if not name:
            continue
        out[key] = name[:_MAX_NAME].rstrip(" .,-·")
    log.info("named %d/%d epic groups via %s", len(out), len(wanted), result.model)
    return out


def generate_epics(
    db: Session,
    project_id: int,
    group_keys: list[str] | None = None,
    names: dict[str, str] | None = None,
) -> EpicGenerateOut:
    """Create the epics and move their members under them.

    Re-parents connector-owned tasks, which sync will not undo (`_upsert_task`
    never writes `parent_id`). That is the point — the hierarchy has to survive
    the next sync — and :func:`ungroup_epic` is the way back.

    `names` overrides the generated label per group key — whatever the user
    settled on in the dialog, whether they typed it or accepted a suggestion.
    """
    proposals, _ungrouped, _needs = _plan(db, project_id)
    wanted = set(group_keys) if group_keys is not None else None
    chosen = names or {}

    created = updated = grouped = skipped = 0
    epic_ids: list[int] = []
    rank = tasks_svc.next_rank(db, project_id)

    for proposal in proposals:
        skipped += proposal.skip_count
        if proposal.conflict is not None:
            continue
        if wanted is not None and proposal.group_key not in wanted:
            continue

        title = (chosen.get(proposal.group_key) or proposal.name).strip()[:_MAX_NAME]

        if proposal.mode == "top_up":
            epic = db.get(Task, proposal.existing_task_id or 0)
            if epic is None or epic.project_id != project_id:
                continue  # deleted between the plan and here
            # A rename on a top-up is intentional; the marker in the description
            # is what identifies the epic, not its title.
            if proposal.group_key in chosen and title:
                epic.title = title
            updated += 1
        else:
            epic = Task(
                project_id=project_id,
                source="local",
                external_key=None,
                title=title or proposal.name,
                # The marker ungroup keys off. Keep the prefix stable.
                description=(
                    f"{GENERATED_MARK}: {proposal.group_key}. "
                    "Delete or ungroup it to undo — its tasks are not copies, "
                    "they are the originals, moved."
                ),
                issue_type="Epic",
                # A container carries no points; its children's roll up.
                story_points=None,
                status_category=StatusCategory.todo,
                rank=rank,
            )
            rank += tasks_svc.RANK_STEP
            db.add(epic)
            db.flush()  # need the id before re-parenting
            created += 1

        for ref in proposal.members:
            if ref.action != "group":
                continue
            task = db.get(Task, ref.task_id)
            # Re-check in this transaction: the plan is a moment old.
            if task is None or task.parent_id is not None or task.id == epic.id:
                continue
            if tasks_svc.would_cycle(db, task.id, epic.id):
                log.warning("skipping %s: parenting under %s would loop", task.id, epic.id)
                continue
            task.parent_id = epic.id
            grouped += 1

        epic_ids.append(epic.id)

    db.commit()
    return EpicGenerateOut(
        created=created,
        updated=updated,
        grouped=grouped,
        skipped=skipped,
        epic_task_ids=epic_ids,
    )


def ungroup_epic(db: Session, project_id: int, task_id: int) -> EpicUngroupOut:
    """Undo one generated epic: release its children, then delete the container.

    Refuses anything this service did not create. A hand-made epic, or one from
    an AI breakdown, is somebody's work — deleting it because it happens to be
    named "PBR 9" would be the worst kind of helpful.
    """
    epic = db.get(Task, task_id)
    if epic is None or epic.project_id != project_id:
        raise HTTPException(404, "Task not found")
    if not (epic.description or "").startswith(GENERATED_MARK):
        raise HTTPException(
            409, "That epic wasn't generated from task numbering, so it isn't safe to dismantle"
        )

    children = list(
        db.execute(select(Task).where(Task.parent_id == epic.id)).scalars().all()
    )
    for child in children:
        child.parent_id = None
    # Its own milestone link would otherwise dangle on a deleted row.
    db.flush()
    db.delete(epic)
    db.commit()
    return EpicUngroupOut(released=len(children), deleted=True)


def generated_epic_ids(db: Session, project_id: int) -> list[int]:
    """Ids of every epic this service made — what an "undo all" would touch."""
    rows = db.execute(
        select(Task).where(Task.project_id == project_id, Task.parent_id.is_(None))
    ).scalars().all()
    return [t.id for t in rows if (t.description or "").startswith(GENERATED_MARK)]
