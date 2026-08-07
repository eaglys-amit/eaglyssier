"""Match discovered accounts to curated members, for review before applying.

Sync creates a ``MemberIdentity`` for every external account it sees (Jira
assignee, git author, PR reviewer) but deliberately never creates a ``Member`` —
the member directory is curated by hand. The consequence is that mapping
identity -> member is a manual click per account, and on a project with three
connectors that is dozens of clicks nobody makes. Everything downstream (KPI,
capacity, evaluation, the Gantt swimlanes) keys off the member, so unmapped
accounts mean silently missing data.

This proposes the mapping instead of doing it: :func:`build_preview` returns
scored candidates, the UI shows them, and :func:`apply_mappings` writes only
what the user confirmed. The rule that sync never invents a member is preserved
— creating one still takes an explicit opt-in per row.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Member, MemberIdentity, ProjectMember
from app.schemas.member import (
    MemberSyncApplyIn,
    MemberSyncApplyOut,
    MemberSyncCandidate,
    MemberSyncPreview,
)


def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


def _norm_name(value: str | None) -> str:
    """Collapse a display name for comparison: case, spacing, punctuation."""
    return " ".join(_norm(value).replace(".", " ").replace("_", " ").split())


def _handle_tokens(value: str | None) -> set[str]:
    """Split a platform handle into its meaningful parts.

    Git hosts have no email on a user, so the username is the only signal there.
    Handles are usually an org prefix plus a name fragment ("acme-jdoe"), so the
    parts are compared individually and short/numeric noise is dropped.
    """
    raw = _norm(value)
    for sep in "-_.+":
        raw = raw.replace(sep, " ")
    return {part for part in raw.split() if len(part) > 2 and not part.isdigit()}


def _name_forms(display_name: str | None) -> set[str]:
    """Handle spellings a person's name plausibly produces.

    e.g. "Peter Gilbert" -> petergilbert, pgilbert, gilbertp, gilbert. The bare
    surname is included because single-token handles are common; the uniqueness
    check in build_preview is what keeps it safe when two people share one.
    """
    parts = _norm_name(display_name).split()
    if not parts:
        return set()
    if len(parts) == 1:
        return {parts[0]}
    first, last = parts[0], parts[-1]
    return {
        f"{first}{last}",
        f"{last}{first}",
        f"{first[0]}{last}",
        f"{last}{first[0]}",
        last,
    }


def build_preview(db: Session, project_id: int) -> MemberSyncPreview:
    """Score every discovered account in the project against the member list."""
    identities = db.execute(
        select(MemberIdentity)
        .where(MemberIdentity.project_id == project_id)
        .order_by(MemberIdentity.system, MemberIdentity.display_name, MemberIdentity.username)
    ).scalars().all()

    members = db.execute(select(Member).order_by(Member.display_name)).scalars().all()
    on_project = set(
        db.execute(
            select(ProjectMember.member_id).where(ProjectMember.project_id == project_id)
        ).scalars().all()
    )

    # Email is the only identifier both sides genuinely share, so it's the only
    # "exact" signal. Names collide across people and usernames are per-platform
    # handles, so both are proposals a human still has to confirm.
    by_email: dict[str, Member] = {}
    for m in members:
        key = _norm(m.primary_email)
        if key:
            by_email.setdefault(key, m)
    by_name: dict[str, list[Member]] = {}
    for m in members:
        by_name.setdefault(_norm_name(m.display_name), []).append(m)
    # Handle spelling -> members who could produce it. Ambiguous spellings are
    # dropped below rather than guessed at.
    by_handle: dict[str, list[Member]] = {}
    for m in members:
        for form in _name_forms(m.display_name):
            by_handle.setdefault(form, []).append(m)

    candidates: list[MemberSyncCandidate] = []
    for ident in identities:
        match: Member | None = None
        reason: str | None = None
        confidence = "none"

        email = _norm(ident.email)
        if email and email in by_email:
            match, reason, confidence = by_email[email], "email", "exact"
        else:
            # A unique hit is a likely match; an ambiguous one is no match,
            # because picking arbitrarily between two people is worse than
            # leaving it for the human.
            display_key = _norm_name(ident.display_name)
            for key, why in ((display_key, "display_name"), (_norm_name(ident.username), "username")):
                if not key:
                    continue
                hits = by_name.get(key, [])
                if len(hits) == 1:
                    match, reason, confidence = hits[0], why, "likely"
                    break

            if match is None:
                # Git hosts expose no email, so fall back to the handle: strip
                # the org prefix and see whether a fragment spells one member's
                # name and only that member's.
                for token in _handle_tokens(ident.username) | _handle_tokens(ident.display_name):
                    hits = by_handle.get(token, [])
                    if len(hits) == 1:
                        match, reason, confidence = hits[0], "username", "likely"
                        break

        candidates.append(
            MemberSyncCandidate(
                identity_id=ident.id,
                system=ident.system.value,
                external_id=ident.external_id,
                username=ident.username,
                email=ident.email,
                display_name=ident.display_name,
                current_member_id=ident.member_id,
                match_member_id=match.id if match else None,
                match_display_name=match.display_name if match else None,
                match_reason=reason,
                confidence=confidence,
                # A match that isn't on the project can't be applied as-is; the
                # UI offers to add them, so flagging it keeps that decision visible.
                match_on_project=match.id in on_project if match else False,
                suggested_display_name=(
                    ident.display_name or ident.username or ident.email or ident.external_id
                ),
            )
        )

    unmapped = [c for c in candidates if c.current_member_id is None]
    return MemberSyncPreview(
        candidates=candidates,
        total=len(candidates),
        already_mapped=len(candidates) - len(unmapped),
        matched=len([c for c in unmapped if c.match_member_id is not None]),
        unmatched=len([c for c in unmapped if c.match_member_id is None]),
    )


def apply_mappings(
    db: Session, project_id: int, data: MemberSyncApplyIn
) -> MemberSyncApplyOut:
    """Write the confirmed mappings, creating and enrolling members as asked.

    Tolerant of stale ids: the preview the user acted on may be a few seconds
    old, and a row that has since disappeared should be skipped rather than
    failing the whole batch.
    """
    created = 0
    mapped = 0
    unmapped = 0

    # New members first, so a mapping in the same request can point at one.
    new_by_identity: dict[int, int] = {}
    for spec in data.create_members:
        ident = db.get(MemberIdentity, spec.identity_id)
        if ident is None or ident.project_id != project_id:
            continue
        member = Member(
            display_name=spec.display_name.strip(),
            primary_email=(spec.primary_email or "").strip() or None,
        )
        db.add(member)
        db.flush()
        new_by_identity[spec.identity_id] = member.id
        created += 1

    for member_id in {*new_by_identity.values(), *(m.member_id for m in data.mappings if m.member_id)}:
        if member_id is None:
            continue
        _ensure_on_project(db, project_id, member_id)

    for mapping in data.mappings:
        ident = db.get(MemberIdentity, mapping.identity_id)
        if ident is None or ident.project_id != project_id:
            continue
        target = mapping.member_id or new_by_identity.get(mapping.identity_id)
        if target is None:
            ident.member_id = None
            unmapped += 1
            continue
        if db.get(Member, target) is None:
            continue  # stale member id — skip rather than orphan the FK
        ident.member_id = target
        mapped += 1

    # An identity created in the same call but not listed under `mappings`
    # should still be linked — that's the whole point of creating it.
    for identity_id, member_id in new_by_identity.items():
        ident = db.get(MemberIdentity, identity_id)
        if ident is not None and ident.member_id is None:
            ident.member_id = member_id
            mapped += 1

    db.commit()
    return MemberSyncApplyOut(created=created, mapped=mapped, unmapped=unmapped)


def _ensure_on_project(db: Session, project_id: int, member_id: int) -> None:
    """Add the member to the project if they aren't already.

    Identities can only be mapped to project members (see the mapping route),
    so enrolling is part of applying a match rather than a separate step.
    """
    exists = db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.member_id == member_id,
        )
    ).scalar_one_or_none()
    if exists is None:
        db.add(ProjectMember(project_id=project_id, member_id=member_id))
        db.flush()
