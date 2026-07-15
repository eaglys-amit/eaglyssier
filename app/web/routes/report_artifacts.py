"""Serve stored report artifacts (HTML view and PDF download).

These keep their non-/api paths: the SPA links to them directly and they are
documents, not JSON resources.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Report
from app.storage import rustfs

router = APIRouter()


@router.get("/reports/{report_id}/view", response_class=HTMLResponse)
def view_report(report_id: int, db: Session = Depends(get_db)):
    report = db.get(Report, report_id)
    if report is None or not report.html_key:
        raise HTTPException(404, "Report not ready")
    return HTMLResponse(rustfs.get_object(report.html_key).decode("utf-8"))


@router.get("/reports/{report_id}/pdf")
def download_pdf(report_id: int, db: Session = Depends(get_db)):
    report = db.get(Report, report_id)
    if report is None or not report.pdf_key:
        raise HTTPException(404, "Report not ready")
    filename = f"report-{report_id}.pdf"
    return Response(
        content=rustfs.get_object(report.pdf_key),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
