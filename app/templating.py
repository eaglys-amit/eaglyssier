"""Jinja2 environment for the report/PDF pipeline.

The web UI is a React SPA (frontend/); Jinja renders only the stored report
HTML and the WeasyPrint PDF source.
"""
from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_REPORT_TEMPLATES = Path(__file__).parent / "reporting" / "templates"

env = Environment(
    loader=FileSystemLoader(str(_REPORT_TEMPLATES)),
    autoescape=select_autoescape(["html", "xml", "j2"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def render(template_name: str, **context) -> str:
    return env.get_template(template_name).render(**context)
