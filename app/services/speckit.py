"""Parse spec-kit style feature folders: specs/<feature>/{spec.md,plan.md,tasks.md}.

Pure functions, no database or network. Follows the github/spec-kit templates:

spec.md
    ``### User Story 1 - Title (Priority: P1)`` sections, each with an
    ``**Acceptance Scenarios**:`` numbered list of Given/When/Then lines, and
    keyed bullet lines ``- **FR-001**: System MUST …`` (also NFR-, SC- …).
tasks.md
    ``- [ ] T012 [P] [US1] Create the model in src/models/x.py`` — a checkbox,
    a task id (numbered per feature, so T001 recurs across features), optional
    ``[P]`` (parallel) and ``[USn]`` (story) tags; "Phase N: User Story N"
    headings imply the story for untagged lines beneath them.

Anything the rules can't read yields an empty list, and the caller falls back
to the LLM extraction used for uploaded documents.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from app.services.spec_diff import Parsed

_KEYED = re.compile(r"^\s*[-*]\s+\*\*(?P<key>[A-Z]{1,6}-\d{1,4})\*\*\s*:?\s*(?P<text>.+?)\s*$")
_STORY = re.compile(
    r"^###\s+User Story\s+(?P<n>\d+)\s*[-–—:]?\s*(?P<title>.*?)"
    r"(?:\s*\(Priority:\s*(?P<p>P\d+)\))?\s*$",
    re.IGNORECASE,
)
_HEADING = re.compile(r"^(?P<hashes>#{1,6})\s+(?P<text>.*)$")
_NUMBERED = re.compile(r"^\s*\d+\.\s+(?P<text>.+?)\s*$")
_TITLE = re.compile(r"^#\s+(?:Feature Specification:\s*)?(?P<title>.+?)\s*$", re.IGNORECASE)
_TASK = re.compile(r"^\s*[-*]\s+\[(?P<done>[ xX])\]\s+(?P<key>T\d{2,})\b[:.]?\s*(?P<rest>.*)$")
_PHASE_STORY = re.compile(r"^#{2,4}\s+Phase\s+\d+\s*:\s*User Story\s+(?P<n>\d+)", re.IGNORECASE)
_REQ_REF = re.compile(r"\b(?:FR|NFR|SC)-\d{1,4}\b")
_TAG = re.compile(r"\[(?P<tag>P|US\d+)\]\s*", re.IGNORECASE)

_KIND_BY_PREFIX = {"FR": "functional", "NFR": "non_functional", "SC": "non_functional"}


def _plain(text: str) -> str:
    """Markdown emphasis and code ticks off; whitespace collapsed."""
    text = re.sub(r"\*\*|__|`", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _short(text: str, limit: int = 80) -> str:
    text = _plain(text)
    if len(text) <= limit:
        return text.rstrip(".")
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(",;:.") + "…"


def _priority_from_text(text: str) -> str | None:
    if re.search(r"\bMUST\b", text):
        return "must"
    if re.search(r"\bSHOULD\b", text):
        return "should"
    if re.search(r"\b(MAY|COULD)\b", text):
        return "could"
    return None


def _priority_from_level(level: str | None) -> str | None:
    if not level:
        return None
    n = int(level[1:])
    return "must" if n <= 1 else "should" if n == 2 else "could"


def spec_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if m := _TITLE.match(line):
            title = _plain(m.group("title"))
            if title and not title.startswith("["):  # unfilled template placeholder
                return title[:512]
    return fallback


def _story(lines: list[str], m: re.Match) -> Parsed:
    title = _plain(m.group("title")) or f"User story {m.group('n')}"
    # The story's own words: the first run of ordinary lines under the heading
    # (labelled blocks like **Why this priority** are commentary, not the story).
    paragraph: list[str] = []
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("**"):
            if paragraph:
                break
            continue
        paragraph.append(stripped)
    scenarios: list[str] = []
    in_scenarios = False
    for line in lines[1:]:
        if re.match(r"^\s*\*\*Acceptance Scenarios\*\*", line, re.IGNORECASE):
            in_scenarios = True
        elif in_scenarios and (sm := _NUMBERED.match(line)):
            scenarios.append(_plain(sm.group("text")))
        elif in_scenarios and line.strip().startswith("**"):
            in_scenarios = False
    statement = _plain(" ".join(paragraph))
    return Parsed(
        key=f"US{m.group('n')}",
        key_from_document=True,
        title=title[:512],
        statement=statement or title,
        kind="user_story",
        priority=_priority_from_level(m.group("p")),
        acceptance_criteria=scenarios[:30],
        # The whole story section: any edit to it — wording, scenarios,
        # priority — is a change worth flagging on the linked work.
        source_excerpt=_plain("\n".join(lines))[:2000],
    )


def parse_spec_md(text: str) -> list[Parsed]:
    """Requirements and user stories, in document order. [] if none are keyed."""
    lines = text.splitlines()
    out: list[Parsed] = []
    seen: set[str] = set()
    i = 0
    while i < len(lines):
        line = lines[i]
        if m := _STORY.match(line):
            j = i + 1
            while j < len(lines):
                h = _HEADING.match(lines[j])
                if (h and len(h.group("hashes")) <= 3) or lines[j].strip() == "---":
                    break
                j += 1
            story = _story(lines[i:j], m)
            if story.key not in seen:
                seen.add(story.key)
                out.append(story)
            i = j
            continue
        if m := _KEYED.match(line):
            key, body = m.group("key"), m.group("text")
            if key not in seen:
                seen.add(key)
                out.append(Parsed(
                    key=key,
                    key_from_document=True,
                    title=_short(body),
                    statement=_plain(body),
                    kind=_KIND_BY_PREFIX.get(key.split("-")[0], "functional"),
                    priority=_priority_from_text(body),
                    source_excerpt=_plain(line)[:2000],
                ))
        i += 1
    return out


@dataclass
class RepoTask:
    key: str
    text: str
    done: bool
    story: str | None = None
    parallel: bool = False
    requirement_keys: list[str] = field(default_factory=list)


def parse_tasks_md(text: str) -> list[RepoTask]:
    out: list[RepoTask] = []
    story: str | None = None
    for line in text.splitlines():
        if pm := _PHASE_STORY.match(line):
            story = f"US{pm.group('n')}"
            continue
        if _HEADING.match(line):
            story = None  # a new non-story phase
            continue
        m = _TASK.match(line)
        if not m:
            continue
        rest = m.group("rest")
        tags = [t.upper() for t in _TAG.findall(rest)]
        task_story = next((t for t in tags if t.startswith("US")), story)
        out.append(RepoTask(
            key=m.group("key"),
            text=_plain(_TAG.sub("", rest)),
            done=m.group("done").lower() == "x",
            story=task_story,
            parallel="P" in tags,
            requirement_keys=sorted(set(_REQ_REF.findall(rest))),
        ))
    return out


# ------------------------------------------------------------------ matching

KEY_MIN_SIMILARITY = 0.5    # a T-id in the title still needs the words to roughly agree
TITLE_MIN_SIMILARITY = 0.8  # without a T-id, the titles must nearly match


@dataclass
class Candidate:
    task_id: int
    title: str


def _words(text: str) -> str:
    return " ".join(re.findall(r"[0-9a-z]+", text.lower()))


def match_tasks(repo_tasks: list[RepoTask], candidates: list[Candidate]) -> dict[str, tuple[int, str]]:
    """repo task key -> (task_id, "key" | "title"). Match-only: never invents tasks.

    T-ids restart at T001 in every feature, so an id in a tracker title is a
    strong hint but not proof: it must also agree with the words. Each tracker
    task matches at most one tasks.md line, best score first.
    """
    scored: list[tuple[float, str, int, str]] = []
    for rt in repo_tasks:
        target = _words(rt.text)
        id_re = re.compile(rf"\b{re.escape(rt.key)}\b", re.IGNORECASE)
        for c in candidates:
            has_id = bool(id_re.search(c.title))
            title = _words(id_re.sub(" ", c.title))
            if not (target and title):
                continue
            sm = SequenceMatcher(None, target, title, autojunk=False)
            floor = KEY_MIN_SIMILARITY if has_id else TITLE_MIN_SIMILARITY
            if sm.quick_ratio() < floor:
                continue
            score = sm.ratio()
            if score >= floor:
                # An id match outranks any id-less match.
                scored.append((score + (1.0 if has_id else 0.0), rt.key, c.task_id,
                               "key" if has_id else "title"))
    scored.sort(reverse=True)
    out: dict[str, tuple[int, str]] = {}
    used: set[int] = set()
    for _score, key, task_id, how in scored:
        if key in out or task_id in used:
            continue
        out[key] = (task_id, how)
        used.add(task_id)
    return out


def mentioned_task_keys(message: str) -> set[str]:
    return set(re.findall(r"\bT\d{2,}\b", message or ""))


def mentioned_requirement_keys(message: str) -> set[str]:
    return set(_REQ_REF.findall(message or ""))
