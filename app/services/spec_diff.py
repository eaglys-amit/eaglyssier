"""Compare a spec's new requirement list with the current one.

Pure: no database. app.services.specs turns the plan into row changes.

Matching, in order:

1. Requirements the spec numbers itself (key_from_document: FR-001, "4.2")
   match the existing requirement with the same key — the author's numbering
   is the most reliable identity there is.
2. Everything else matches by text similarity of the verbatim source excerpt
   (falling back to the statement), best pairs first. Generated keys (R-3)
   are ours, so the existing key is kept when matched.

Changed vs unchanged is judged on the verbatim excerpt too, never on the
model's paraphrase: re-extracting an untouched paragraph rewords the
statement, and that must not light up as a change. It is deliberately strict:
the same words, or the same words plus whole neighbouring sentences (the model
quoting a sentence more or less of context). A one-character edit ("30" → "10
minutes", "must" → "must not") or an added clause ("by date" → "by date and
location") counts as changed — a false alarm costs a review, a missed change
is what this exists to prevent.

Manual requirements (added by hand, key_origin "manual") never take part —
they aren't in the source, so a new version can't match or remove them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

MATCH_THRESHOLD = 0.72  # similar enough to be the same requirement
_GENERATED = re.compile(r"^R-(\d+)$")


@dataclass
class Parsed:
    key: str | None
    key_from_document: bool
    title: str
    statement: str
    kind: str = "functional"
    priority: str | None = None
    acceptance_criteria: list[str] = field(default_factory=list)
    source_excerpt: str | None = None

    @property
    def basis(self) -> str:
        return _norm(self.source_excerpt or self.statement or self.title)


@dataclass
class Existing:
    id: int
    key: str
    key_origin: str
    statement: str
    source_excerpt: str | None
    acceptance_criteria: list[str]
    change_state: str

    @property
    def basis(self) -> str:
        return _norm(self.source_excerpt or self.statement)


@dataclass
class Match:
    existing_id: int
    parsed: Parsed
    changed: bool
    key: str  # the key the requirement keeps


@dataclass
class Plan:
    matches: list[Match] = field(default_factory=list)
    added: list[tuple[str, Parsed]] = field(default_factory=list)  # (assigned key, parsed)
    removed: list[int] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "added": len(self.added),
            "changed": sum(1 for m in self.matches if m.changed),
            "removed": len(self.removed),
        }


def _norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def normalize_key(key: str | None) -> str | None:
    key = re.sub(r"\s+", "", key or "").strip(".:")
    return key.upper()[:64] or None


def _words(text: str) -> str:
    return " ".join(re.findall(r"[0-9a-z]+", text))


def _sentences(text: str) -> list[str]:
    return [w for s in re.split(r"(?<=[.!?;])\s+", text) if (w := _words(s))]


def _same_passage(a: str, b: str) -> bool:
    """Same words, or one is a run of whole sentences of the other."""
    wa, wb = _words(a), _words(b)
    if wa == wb:
        return True
    short, long_ = (a, b) if len(wa) < len(wb) else (b, a)
    target = _words(short)
    sentences = _sentences(long_)
    for i in range(len(sentences)):
        for j in range(i + 1, len(sentences) + 1):
            if " ".join(sentences[i:j]) == target:
                return True
    return False


def _changed(old: Existing, new: Parsed) -> bool:
    if not _same_passage(old.basis, new.basis):
        return True
    return [_norm(c) for c in old.acceptance_criteria] != [
        _norm(c) for c in new.acceptance_criteria
    ]


def plan_version(existing: list[Existing], parsed: list[Parsed]) -> Plan:
    plan = Plan()
    pool = {e.id: e for e in existing if e.key_origin != "manual"}
    taken_keys = {e.key for e in existing}
    pending: list[Parsed] = []

    # 1. The document's own numbering.
    by_key = {e.key: e for e in pool.values()}
    for p in parsed:
        key = normalize_key(p.key) if p.key_from_document else None
        old = by_key.get(key) if key else None
        if old is not None and old.id in pool:
            plan.matches.append(Match(old.id, p, _changed(old, p), old.key))
            del pool[old.id]
        else:
            pending.append(p)

    # 2. Text similarity, best pairs first.
    pairs = []
    for i, p in enumerate(pending):
        for e in pool.values():
            if not (e.basis and p.basis):
                continue
            sm = SequenceMatcher(None, e.basis, p.basis, autojunk=False)
            # quick_ratio() is a cheap upper bound: most pairs stop here.
            if sm.quick_ratio() >= MATCH_THRESHOLD and (score := sm.ratio()) >= MATCH_THRESHOLD:
                pairs.append((score, i, e.id))
    pairs.sort(reverse=True)
    used: set[int] = set()
    for _score, i, eid in pairs:
        if i in used or eid not in pool:
            continue
        old, p = pool.pop(eid), pending[i]
        used.add(i)
        plan.matches.append(Match(old.id, p, _changed(old, p), old.key))

    # 3. Whatever is left is new, or gone.
    next_n = 1 + max(
        (int(m.group(1)) for k in taken_keys if (m := _GENERATED.match(k))), default=0
    )
    for i, p in enumerate(pending):
        if i in used:
            continue
        key = normalize_key(p.key) if p.key_from_document else None
        if not key or key in taken_keys:
            key = f"R-{next_n}"
            next_n += 1
        taken_keys.add(key)
        plan.added.append((key, p))
    plan.removed = [eid for eid, e in pool.items() if e.change_state != "removed"]
    return plan
