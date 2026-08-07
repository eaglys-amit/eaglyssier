"""Reference documents: store the bytes, extract the text, feed the prompt.

Text is extracted once, at upload, and kept on the row. Under the size cap that
takes well under a second, so making it a background job would cost the UI a
whole polling cycle for a step that is normally instant — the ``extract_status``
columns exist anyway so a failure is visible and retryable.

Nothing here does OCR. A scanned PDF extracts to nothing, which is reported as
``char_count == 0`` rather than as an error, because the upload did succeed and
the file is still downloadable — it just can't inform a prompt.
"""
from __future__ import annotations

import io
import logging
import re
from html.parser import HTMLParser

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ReferenceFile
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


def extract(kind: str, data: bytes) -> str:
    """Plain text for one document. Raises only on a genuinely broken file."""
    if kind == "pdf":
        return _from_pdf(data)
    if kind == "html":
        return _from_html(data)
    return data.decode("utf-8", errors="replace")


# --------------------------------------------------------------------- storage


def store_reference(
    db: Session,
    project_id: int,
    *,
    filename: str,
    content_type: str,
    data: bytes,
    task_id: int | None = None,
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
    # Content sniff on top of the extension: a .pdf that isn't one would blow up
    # in the extractor with a far less useful message.
    if kind == "pdf" and not data.startswith(b"%PDF-"):
        raise ReferenceError(415, f"{filename} is not a valid PDF.")

    row = ReferenceFile(
        project_id=project_id,
        task_id=task_id,
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
