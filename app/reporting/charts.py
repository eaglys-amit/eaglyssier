"""Server-rendered SVG charts for reports.

Hand-built SVG (no plotting lib) so the same markup renders identically in the
HTML view and the WeasyPrint PDF. Colors use the validated data-viz palette;
every bar carries a direct value label (relief rule) so identity/magnitude never
rely on color alone.
"""
from __future__ import annotations

from datetime import date, timedelta
from html import escape

from app.schemas.report import MemberReport

# validated palette (light surface) --------------------------------------------
_ASSIGNED = "#2a78d6"   # categorical slot 1 (blue)
_COMPLETED = "#1baf7a"  # categorical slot 2 (aqua)
_SINGLE = "#2a78d6"
_INK = "#0b0b0b"
_MUTED = "#898781"
_BASELINE = "#c3c2b7"

_ROW_H = 26
_GAP = 10
_PAD_L = 140
_PAD_R = 60
_PAD_T = 40
_BAR_W_MAX = 320


def _svg_open(width: int, height: int) -> str:
    return (
        f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
        f'role="img" xmlns="http://www.w3.org/2000/svg" '
        f'font-family="system-ui, -apple-system, sans-serif">'
    )


def _label(x: int, y: int, text: str, anchor: str = "end", fill: str = _INK, size: int = 12) -> str:
    return (
        f'<text x="{x}" y="{y}" text-anchor="{anchor}" fill="{fill}" '
        f'font-size="{size}" dominant-baseline="middle">{escape(text)}</text>'
    )


def _bar(x: int, y: int, w: int, h: int, fill: str) -> str:
    w = max(w, 0)
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" ry="4" fill="{fill}"/>'


def story_point_chart(members: list[MemberReport]) -> str:
    """Grouped horizontal bars: assigned vs completed story points per member."""
    rows = [m for m in members if m.assigned_sp > 0][:12]
    if not rows:
        return _empty("No story-point data")

    max_sp = max(m.assigned_sp for m in rows) or 1
    bar_h = 9
    group_h = _ROW_H + _GAP
    height = _PAD_T + len(rows) * group_h + 20
    width = _PAD_L + _BAR_W_MAX + _PAD_R

    parts = [_svg_open(width, height)]
    # legend
    parts.append(_bar(_PAD_L, 14, 12, 12, _ASSIGNED))
    parts.append(_label(_PAD_L + 18, 20, "Assigned", "start", _MUTED, 11))
    parts.append(_bar(_PAD_L + 90, 14, 12, 12, _COMPLETED))
    parts.append(_label(_PAD_L + 108, 20, "Completed", "start", _MUTED, 11))

    for i, m in enumerate(rows):
        top = _PAD_T + i * group_h
        parts.append(_label(_PAD_L - 10, top + _ROW_H / 2, _truncate(m.name), "end", _INK, 12))
        aw = int(_BAR_W_MAX * m.assigned_sp / max_sp)
        cw = int(_BAR_W_MAX * m.completed_sp / max_sp)
        parts.append(_bar(_PAD_L, top + 2, aw, bar_h, _ASSIGNED))
        parts.append(_bar(_PAD_L, top + 2 + bar_h + 4, cw, bar_h, _COMPLETED))
        parts.append(
            _label(_PAD_L + max(aw, cw) + 6, top + _ROW_H / 2,
                   f"{_fmt(m.completed_sp)}/{_fmt(m.assigned_sp)} SP", "start", _MUTED, 11)
        )
    parts.append("</svg>")
    return "".join(parts)


def velocity_chart(sprint_rows) -> str:
    """Grouped horizontal bars: planned vs completed story points per sprint."""
    rows = [s for s in sprint_rows if s.planned_sp > 0 or s.completed_sp > 0]
    if not rows:
        return _empty("No sprint velocity data")

    max_sp = max((s.planned_sp for s in rows), default=1) or 1
    bar_h = 9
    group_h = _ROW_H + _GAP
    height = _PAD_T + len(rows) * group_h + 20
    width = _PAD_L + _BAR_W_MAX + _PAD_R

    parts = [_svg_open(width, height)]
    parts.append(_bar(_PAD_L, 14, 12, 12, _ASSIGNED))
    parts.append(_label(_PAD_L + 18, 20, "Planned", "start", _MUTED, 11))
    parts.append(_bar(_PAD_L + 84, 14, 12, 12, _COMPLETED))
    parts.append(_label(_PAD_L + 102, 20, "Completed", "start", _MUTED, 11))

    for i, s in enumerate(rows):
        top = _PAD_T + i * group_h
        parts.append(_label(_PAD_L - 10, top + _ROW_H / 2, _truncate(s.name), "end", _INK, 12))
        pw = int(_BAR_W_MAX * s.planned_sp / max_sp)
        cw = int(_BAR_W_MAX * s.completed_sp / max_sp)
        parts.append(_bar(_PAD_L, top + 2, pw, bar_h, _ASSIGNED))
        parts.append(_bar(_PAD_L, top + 2 + bar_h + 4, cw, bar_h, _COMPLETED))
        parts.append(
            _label(_PAD_L + max(pw, cw) + 6, top + _ROW_H / 2,
                   f"{_fmt(s.completed_sp)}/{_fmt(s.planned_sp)} SP", "start", _MUTED, 11)
        )
    parts.append("</svg>")
    return "".join(parts)


def contribution_chart(members: list[MemberReport]) -> str:
    """Horizontal bars: commit count per member (single series)."""
    rows = sorted([m for m in members if m.commits > 0], key=lambda m: m.commits, reverse=True)[:12]
    if not rows:
        return _empty("No commit data")

    max_c = max(m.commits for m in rows) or 1
    row_h = _ROW_H
    height = _PAD_T + len(rows) * (row_h + _GAP) + 10
    width = _PAD_L + _BAR_W_MAX + _PAD_R

    parts = [_svg_open(width, height)]
    parts.append(_label(_PAD_L, 20, "Commits per member", "start", _MUTED, 11))
    for i, m in enumerate(rows):
        top = _PAD_T + i * (row_h + _GAP)
        parts.append(_label(_PAD_L - 10, top + row_h / 2, _truncate(m.name), "end", _INK, 12))
        w = int(_BAR_W_MAX * m.commits / max_c)
        parts.append(_bar(_PAD_L, top + 4, w, row_h - 8, _SINGLE))
        parts.append(
            _label(_PAD_L + w + 6, top + row_h / 2,
                   f"{m.commits}  (+{m.additions}/-{m.deletions})", "start", _MUTED, 11)
        )
    parts.append("</svg>")
    return "".join(parts)


_HEALTH_FILL = {
    "on_track": "#2a78d6",
    "at_risk": "#eda100",
    "off_track": "#d03b3b",
    "overdue": "#d03b3b",
    "complete": "#1baf7a",
}


def roadmap_chart(milestones: list[dict], today) -> str:
    """Open milestones on a date axis: target tick, P50–P85 band, health colour.

    Every row also prints its dates and chance as text, so nothing depends on
    reading the colour or the geometry.
    """
    def d(v):
        return date.fromisoformat(v) if isinstance(v, str) else v

    rows = [m for m in milestones if m.get("health") != "complete"
            and (m.get("target_date") or m.get("forecast_p50"))][:12]
    if not rows:
        return _empty("No open milestones with dates")

    dates = [today]
    for m in rows:
        dates += [d(m[k]) for k in ("target_date", "forecast_p50", "forecast_p85") if m.get(k)]
    lo = min(dates)
    hi = max(max(dates), lo + timedelta(days=14))
    span = (hi - lo).days or 1

    width = _PAD_L + _BAR_W_MAX + 170
    row_h = _ROW_H + 6
    height = _PAD_T + len(rows) * row_h + 10

    def x(v) -> int:
        return _PAD_L + int(_BAR_W_MAX * (d(v) - lo).days / span)

    parts = [_svg_open(width, height)]
    parts.append(_label(_PAD_L, 14, lo.isoformat(), "start", _MUTED, 10))
    parts.append(_label(_PAD_L + _BAR_W_MAX, 14, hi.isoformat(), "end", _MUTED, 10))
    tx = x(today)
    parts.append(f'<line x1="{tx}" y1="24" x2="{tx}" y2="{height - 6}" stroke="{_MUTED}" '
                 f'stroke-dasharray="3 3"/>')
    parts.append(_label(tx, 30, "today", "middle", _MUTED, 9))
    for i, m in enumerate(rows):
        mid = _PAD_T + i * row_h + row_h / 2
        fill = _HEALTH_FILL.get(m.get("health"), _BASELINE)
        parts.append(_label(_PAD_L - 10, mid, _truncate(m["name"], 20), "end", _INK, 12))
        parts.append(f'<line x1="{_PAD_L}" y1="{mid}" x2="{_PAD_L + _BAR_W_MAX}" y2="{mid}" '
                     f'stroke="{_BASELINE}" stroke-width="1"/>')
        if m.get("forecast_p50"):
            x50 = x(m["forecast_p50"])
            x85 = x(m.get("forecast_p85") or m["forecast_p50"])
            parts.append(_bar(x50, int(mid - 6), max(x85 - x50, 3), 12, fill))
        if m.get("target_date"):
            xt = x(m["target_date"])
            parts.append(f'<path d="M{xt} {mid - 7} L{xt + 6} {mid} L{xt} {mid + 7} '
                         f'L{xt - 6} {mid} Z" fill="{_INK}"/>')
        chance = m.get("on_time_probability")
        note = f"{round(chance * 100)}% on time" if chance is not None else (
            "no forecast" if not m.get("forecast_p50") else "low confidence")
        parts.append(_label(_PAD_L + _BAR_W_MAX + 10, mid, note, "start", _MUTED, 11))
    parts.append("</svg>")
    return "".join(parts)


def _empty(msg: str) -> str:
    return (
        f'{_svg_open(400, 60)}'
        f'{_label(200, 30, msg, "middle", _MUTED, 12)}</svg>'
    )


def _truncate(name: str, n: int = 18) -> str:
    return name if len(name) <= n else name[: n - 1] + "…"


def _fmt(v: float) -> str:
    return str(int(v)) if v == int(v) else f"{v:.1f}"


def build_charts(ctx) -> dict[str, str]:
    charts = {
        "story_points": story_point_chart(ctx.members),
        "contribution": contribution_chart(ctx.members),
    }
    if ctx.sprint_breakdown:
        charts["velocity"] = velocity_chart(ctx.sprint_breakdown)
    if ctx.executive is not None:
        charts["roadmap"] = roadmap_chart(ctx.executive.milestones, ctx.generated_at.date())
    return charts
