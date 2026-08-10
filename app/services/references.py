"""Reference documents: store the bytes, extract the text, feed the prompt.

Text is extracted once, at upload, and kept on the row. Under the size cap that
takes well under a second, so making it a background job would cost the UI a
whole polling cycle for a step that is normally instant — the ``extract_status``
columns exist anyway so a failure is visible and retryable.

Nothing here does OCR. A scanned PDF, or a deck that is entirely images,
extracts to nothing — reported as ``char_count == 0`` rather than as an error,
because the upload did succeed and the file is still downloadable; it just
can't inform a prompt.

Every format is read with the standard library or a zero-dependency package.
python-pptx would have pulled in lxml and xlsxwriter to read text out of a zip
of XML, and beautifulsoup would have done the same for HTML — the consumer here
is an LLM prompt, which tolerates imperfect reading order far better than a
renderer would.
"""
from __future__ import annotations

import io
import logging
import posixpath
import re
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ReferenceFile, ReferenceFolder
from app.storage import rustfs

log = logging.getLogger("app.services.references")

# Extension -> kind. Extension is the primary check: browsers disagree wildly on
# the MIME type for .md (text/markdown, text/plain, or empty).
_KINDS = {
    "md": "md",
    "markdown": "md",
    "txt": "txt",
    "text": "txt",
    "html": "html",
    "htm": "html",
    "pdf": "pdf",
    "pptx": "pptx",
}

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class ReferenceError(HTTPException):
    """A rejected upload — wrong type, too big, or unreadable."""


def kind_for(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    kind = _KINDS.get(ext)
    if kind is None:
        allowed = ", ".join(sorted({f".{k}" for k in _KINDS}))
        raise ReferenceError(415, f"{filename}: only {allowed} are supported.")
    return kind


def safe_filename(filename: str) -> str:
    """Collapse anything path- or shell-hostile out of a filename."""
    base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = _SAFE_NAME.sub("_", base).strip("._") or "document"
    return cleaned[:200]


# ------------------------------------------------------------------ extraction


class _TextExtractor(HTMLParser):
    """Visible text from HTML. Stdlib only — beautifulsoup would be overkill."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001 - stdlib signature
        if tag in ("script", "style", "noscript"):
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1
        elif tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip and data.strip():
            self.parts.append(data)


def _from_html(data: bytes) -> str:
    parser = _TextExtractor()
    parser.feed(data.decode("utf-8", errors="replace"))
    parser.close()
    text = "".join(parser.parts)
    # Collapse the blank-line storm that block-tag newlines produce.
    return re.sub(r"\n{3,}", "\n\n", text)


def _from_pdf(data: bytes) -> str:
    from pypdf import PdfReader  # imported lazily; only PDFs pay for it

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception as exc:  # noqa: BLE001 - one bad page shouldn't lose the rest
            log.warning("pdf page extraction failed: %s", exc)
    return "\n\n".join(p for p in pages if p.strip())


# --- PowerPoint -------------------------------------------------------------
#
# A .pptx is a zip of OOXML. Slide text lives in <a:t> runs inside <a:p>
# paragraphs, and speaker notes hang off a *relationship* rather than a
# matching filename — notesSlide3.xml is not necessarily slide 3's.

_DRAWING_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_RELS_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_NOTES_REL = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
)
_SLIDE_RE = re.compile(r"ppt/slides/slide(\d+)\.xml$")


def _para_text(node) -> str:
    """A paragraph's text: its runs concatenated, since formatting splits them."""
    return "".join(run.text or "" for run in node.iter(f"{_DRAWING_NS}t")).strip()


def _slide_lines(root) -> list[str]:
    """One slide's text in document order, with table cells kept as rows.

    Document order matters: emitting every table first would put a slide's title
    after its table, which is not how anyone reads the slide.
    """
    in_table = {
        id(para)
        for table in root.iter(f"{_DRAWING_NS}tbl")
        for para in table.iter(f"{_DRAWING_NS}p")
    }
    lines: list[str] = []
    for node in root.iter():
        if node.tag == f"{_DRAWING_NS}tbl":
            for row in node.iter(f"{_DRAWING_NS}tr"):
                cells = [
                    " ".join(
                        filter(
                            None,
                            (_para_text(p) for p in cell.iter(f"{_DRAWING_NS}p")),
                        )
                    )
                    for cell in row.iter(f"{_DRAWING_NS}tc")
                ]
                if any(cells):
                    lines.append(" | ".join(cells))
        elif node.tag == f"{_DRAWING_NS}p" and id(node) not in in_table:
            text = _para_text(node)
            if text:
                lines.append(text)
    return lines


def _from_pptx(data: bytes) -> str:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ReferenceError(415, "That .pptx is not a readable PowerPoint file.") from None

    blocks: list[str] = []
    with archive as z:
        names = set(z.namelist())
        slides = sorted(
            (n for n in names if _SLIDE_RE.fullmatch(n)),
            key=lambda n: int(_SLIDE_RE.fullmatch(n).group(1)),
        )
        for index, name in enumerate(slides, start=1):
            try:
                lines = _slide_lines(ElementTree.fromstring(z.read(name)))
            except ElementTree.ParseError as exc:
                # One malformed slide shouldn't cost the whole deck.
                log.warning("pptx slide %s unreadable: %s", name, exc)
                continue

            notes: list[str] = []
            rels = f"ppt/slides/_rels/{posixpath.basename(name)}.rels"
            if rels in names:
                try:
                    for rel in ElementTree.fromstring(z.read(rels)).iter(
                        f"{_RELS_NS}Relationship"
                    ):
                        if rel.get("Type") != _NOTES_REL:
                            continue
                        target = posixpath.normpath(
                            posixpath.join("ppt/slides", rel.get("Target", ""))
                        )
                        if target in names:
                            notes = _slide_lines(ElementTree.fromstring(z.read(target)))
                except ElementTree.ParseError:
                    pass  # notes are a bonus, never worth failing the slide over

            if lines or notes:
                block = f"## Slide {index}\n" + "\n".join(lines)
                if notes:
                    block += "\n[speaker notes] " + " ".join(notes)
                blocks.append(block)
    return "\n\n".join(blocks)


def extract(kind: str, data: bytes) -> str:
    """Plain text for one document. Raises only on a genuinely broken file."""
    if kind == "pdf":
        return _from_pdf(data)
    if kind == "pptx":
        return _from_pptx(data)
    if kind == "html":
        return _from_html(data)
    return data.decode("utf-8", errors="replace")


# --------------------------------------------------------------------- folders
#
# The tree is an adjacency list (ReferenceFolder.parent_id). Every guard below
# works on the project's full folder list, loaded once: these trees are small
# enough that one SELECT beats a recursive CTE per check, and it keeps the cycle
# and sibling-name rules readable.


class FolderError(HTTPException):
    """An invalid folder operation — bad name, bad parent, or a cycle."""


def list_folders(db: Session, project_id: int) -> list[ReferenceFolder]:
    """Every folder in the project, flat. The caller nests them."""
    return list(
        db.execute(
            select(ReferenceFolder)
            .where(ReferenceFolder.project_id == project_id)
            .order_by(ReferenceFolder.name)
        )
        .scalars()
        .all()
    )


def _clean_name(name: str) -> str:
    """Collapse whitespace and strip path separators.

    Separators are stripped rather than rejected because a user pasting
    "specs/api" means one folder named that, not a silent second level — and
    letting them through would make a folder name that reads like a path it
    isn't. Storage keys don't use folder names at all (see store_reference), so
    this is purely about the name being honest.
    """
    cleaned = re.sub(r"\s+", " ", name.replace("/", " ").replace("\\", " ")).strip()
    if not cleaned:
        raise FolderError(422, "A folder needs a name.")
    return cleaned[:255]


def get_folder_or_404(db: Session, project_id: int, folder_id: int) -> ReferenceFolder:
    row = db.get(ReferenceFolder, folder_id)
    if row is None or row.project_id != project_id:
        raise FolderError(404, "Folder not found in this project")
    return row


def _assert_name_free(
    db: Session,
    project_id: int,
    *,
    parent_id: int | None,
    name: str,
    exclude_id: int | None = None,
) -> None:
    """Reject a duplicate sibling name, case-insensitively.

    Enforced here rather than as a UniqueConstraint: Postgres treats NULLs as
    distinct, so the constraint would not cover top-level folders, which is
    where a duplicate is most likely to be created by accident.
    """
    clash = next(
        (
            f
            for f in list_folders(db, project_id)
            if f.parent_id == parent_id
            and f.id != exclude_id
            and f.name.casefold() == name.casefold()
        ),
        None,
    )
    if clash is not None:
        where = "this folder" if parent_id else "the top level"
        raise FolderError(409, f'"{clash.name}" already exists in {where}.')


def _descendant_ids(folders: list[ReferenceFolder], root_id: int) -> set[int]:
    """root_id plus every folder beneath it."""
    children: dict[int | None, list[int]] = {}
    for f in folders:
        children.setdefault(f.parent_id, []).append(f.id)
    seen = {root_id}
    stack = [root_id]
    while stack:
        for child in children.get(stack.pop(), []):
            if child not in seen:
                seen.add(child)
                stack.append(child)
    return seen


def create_folder(
    db: Session, project_id: int, *, name: str, parent_id: int | None = None
) -> ReferenceFolder:
    clean = _clean_name(name)
    if parent_id is not None:
        get_folder_or_404(db, project_id, parent_id)
    _assert_name_free(db, project_id, parent_id=parent_id, name=clean)
    row = ReferenceFolder(project_id=project_id, parent_id=parent_id, name=clean)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_folder(
    db: Session,
    project_id: int,
    folder_id: int,
    *,
    name: str | None = None,
    parent_id: int | None = None,
    reparent: bool = False,
) -> ReferenceFolder:
    """Rename and/or move a folder.

    ``reparent`` distinguishes "leave the parent alone" from "move to the root",
    which ``parent_id=None`` alone cannot express.
    """
    row = get_folder_or_404(db, project_id, folder_id)
    target_parent = parent_id if reparent else row.parent_id

    if reparent and parent_id is not None:
        get_folder_or_404(db, project_id, parent_id)
        # A folder can't be moved inside itself or its own subtree: the rows
        # would survive but become unreachable from the root, invisible in
        # every view and impossible to move back.
        if parent_id in _descendant_ids(list_folders(db, project_id), folder_id):
            raise FolderError(409, "A folder can't be moved into itself.")

    clean = _clean_name(name) if name is not None else row.name
    _assert_name_free(
        db, project_id, parent_id=target_parent, name=clean, exclude_id=folder_id
    )

    row.name = clean
    row.parent_id = target_parent
    db.commit()
    db.refresh(row)
    return row


def delete_folder(db: Session, project_id: int, folder_id: int) -> None:
    """Delete a folder and its subfolders. Documents survive at the root.

    Both rules are the database's: parent_id CASCADEs onto subfolders,
    reference_files.folder_id is SET NULL. Nothing is deleted from storage here,
    which is the point — see the note on the ReferenceFolder model.
    """
    row = db.get(ReferenceFolder, folder_id)
    if row is None or row.project_id != project_id:
        return
    db.delete(row)
    db.commit()


def move_file(db: Session, file_id: int, folder_id: int | None) -> ReferenceFile:
    """Re-file a document. ``folder_id=None`` moves it to the project root."""
    row = db.get(ReferenceFile, file_id)
    if row is None:
        raise FolderError(404, "Reference file not found")
    if folder_id is not None:
        get_folder_or_404(db, row.project_id, folder_id)
    row.folder_id = folder_id
    db.commit()
    db.refresh(row)
    return row


# --------------------------------------------------------------------- storage


def store_reference(
    db: Session,
    project_id: int,
    *,
    filename: str,
    content_type: str,
    data: bytes,
    task_id: int | None = None,
    folder_id: int | None = None,
) -> ReferenceFile:
    """Persist one document and extract its text.

    Write order matters: the row is inserted and flushed first because the
    storage key contains its id, and a storage failure then rolls the row back
    rather than leaving a record pointing at nothing.
    """
    kind = kind_for(filename)
    if not data:
        raise ReferenceError(422, f"{filename} is empty.")
    if len(data) > settings.reference_max_bytes:
        limit = settings.reference_max_bytes // 1_000_000
        raise ReferenceError(413, f"{filename} is larger than the {limit} MB limit.")
    # Content sniff on top of the extension: a file that isn't what its name
    # claims would otherwise blow up in the extractor with a far less useful
    # message. "PK" is the zip magic every OOXML file starts with.
    if kind == "pdf" and not data.startswith(b"%PDF-"):
        raise ReferenceError(415, f"{filename} is not a valid PDF.")
    if kind == "pptx" and not data.startswith(b"PK"):
        raise ReferenceError(415, f"{filename} is not a valid PowerPoint file.")

    row = ReferenceFile(
        project_id=project_id,
        task_id=task_id,
        folder_id=folder_id,
        filename=filename[:512],
        content_type=content_type or "application/octet-stream",
        size_bytes=len(data),
        kind=kind,
        storage_key="",  # set below, once the row has an id
    )
    db.add(row)
    db.flush()

    rustfs.ensure_bucket()
    row.storage_key = rustfs.put_object(
        f"references/{project_id}/{row.id}/{safe_filename(filename)}",
        data,
        row.content_type,
    )

    _apply_extraction(row, data)
    db.commit()
    db.refresh(row)
    return row


def _apply_extraction(row: ReferenceFile, data: bytes) -> None:
    """Extract into the row; records failure instead of failing the upload."""
    try:
        text = extract(row.kind, data).strip()
    except Exception as exc:  # noqa: BLE001 - surface it, keep the file
        row.extracted_text = None
        row.char_count = 0
        row.extract_status = "failed"
        row.extract_error = str(exc)[:1000]
        return
    row.extracted_text = text[: settings.reference_max_chars] or None
    row.char_count = len(row.extracted_text or "")
    row.extract_status = "ready"
    row.extract_error = None


def re_extract(db: Session, file_id: int) -> ReferenceFile | None:
    """Re-run extraction by pulling the bytes back out of storage."""
    row = db.get(ReferenceFile, file_id)
    if row is None:
        return None
    try:
        data = rustfs.get_object(row.storage_key)
    except Exception as exc:  # noqa: BLE001 - storage gone or key wrong
        row.extract_status = "failed"
        row.extract_error = f"Could not read the stored file: {str(exc)[:500]}"
        db.commit()
        db.refresh(row)
        return row
    _apply_extraction(row, data)
    db.commit()
    db.refresh(row)
    return row


def delete_reference(db: Session, file_id: int) -> None:
    """Tolerant delete. The blob goes best-effort, like report artifacts."""
    row = db.get(ReferenceFile, file_id)
    if row is None:
        return
    key = row.storage_key
    db.delete(row)
    db.commit()
    if key:
        try:
            rustfs.delete_object(key)
        except Exception as exc:  # noqa: BLE001 - an orphan blob is not worth a 500
            log.warning("could not delete reference blob %s: %s", key, exc)


def list_references(
    db: Session, project_id: int, task_id: int | None = None
) -> list[ReferenceFile]:
    stmt = select(ReferenceFile).where(ReferenceFile.project_id == project_id)
    if task_id is not None:
        stmt = stmt.where(ReferenceFile.task_id == task_id)
    return list(db.execute(stmt.order_by(ReferenceFile.id.desc())).scalars().all())


# Below this a per-file slice is too short to carry any useful context, so the
# budget is spent on fewer documents rather than on useless fragments of many.
_MIN_SLICE = 1000


def documents_text(db: Session, file_ids: list[int], budget: int | None = None) -> str:
    """Concatenate the selected documents for a prompt, under a char budget.

    The budget is split evenly so one long spec can't crowd out the others, but
    never below ``_MIN_SLICE`` — and because that floor could otherwise push the
    total past the budget, documents that no longer fit are dropped with an
    explicit note. Silently overshooting the budget would get the prompt
    truncated by the model instead, losing the tail without saying so.

    Files whose text couldn't be extracted are still listed, so the model knows
    they exist rather than reasoning as though they don't.
    """
    if not file_ids:
        return ""
    budget = budget or settings.breakdown_max_prompt_chars
    rows = list(
        db.execute(
            select(ReferenceFile).where(ReferenceFile.id.in_(file_ids))
        ).scalars().all()
    )
    if not rows:
        return ""
    # Preserve the caller's ordering — earlier files are the more important ones.
    order = {fid: i for i, fid in enumerate(file_ids)}
    rows.sort(key=lambda r: order.get(r.id, len(order)))

    per_file = max(_MIN_SLICE, budget // len(rows))
    chunks: list[str] = []
    spent = 0
    dropped = 0

    for row in rows:
        header = f"### {row.filename}\n"
        if row.extract_status != "ready" or not row.extracted_text:
            body = "(text could not be extracted from this file)"
        else:
            body = row.extracted_text[:per_file]
            if len(row.extracted_text) > per_file:
                body += "\n…(truncated)"

        cost = len(header) + len(body)
        if spent + cost > budget and chunks:
            dropped += 1
            continue
        chunks.append(header + body)
        spent += cost

    if dropped:
        chunks.append(
            f"({dropped} further document(s) omitted — the context budget was reached.)"
        )
    return "\n\n".join(chunks)
