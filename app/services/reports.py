"""Report generation: metrics -> render HTML -> PDF -> RustFS -> persist."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Report, ReportStatus
from app.reporting.charts import build_charts
from app.services.metrics import build_report_context
from app.storage import rustfs
from app.templating import render

_TEMPLATE = {"sprint": "reports/sprint_report.html.j2", "project": "reports/project_report.html.j2"}


def render_report_html(db: Session, project_id: int, scope: dict | None) -> tuple[str, str]:
    """Build context and return (title, html). Reused by preview and generation."""
    ctx = build_report_context(db, project_id, scope)
    ctx.charts = build_charts(ctx)
    template = _TEMPLATE.get(ctx.report_type, _TEMPLATE["sprint"])
    html = render(template, ctx=ctx)
    return ctx.title, html


def generate_report(db: Session, report_id: int) -> Report:
    """Render + store artifacts for an existing (pending) Report row."""
    report = db.get(Report, report_id)
    if report is None:
        raise ValueError(f"Report {report_id} not found")

    report.status = ReportStatus.generating
    db.commit()

    try:
        title, html = render_report_html(db, report.project_id, report.scope or {})

        # Lazy import: WeasyPrint pulls heavy native libs; keep import local.
        from weasyprint import HTML

        pdf_bytes = HTML(string=html).write_pdf()

        rustfs.ensure_bucket()
        base = f"reports/{report.project_id}/{report.id}"
        html_key = rustfs.put_object(f"{base}/report.html", html.encode("utf-8"), "text/html")
        pdf_key = rustfs.put_object(f"{base}/report.pdf", pdf_bytes, "application/pdf")

        report.title = title
        report.html_key = html_key
        report.pdf_key = pdf_key
        report.status = ReportStatus.ready
        report.generated_at = datetime.now(timezone.utc)
        report.error = None
    except Exception as exc:  # noqa: BLE001
        report.status = ReportStatus.failed
        report.error = str(exc)[:2000]
    db.commit()
    return report
