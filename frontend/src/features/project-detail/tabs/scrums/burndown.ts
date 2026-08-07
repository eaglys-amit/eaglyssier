import type { Burndown, BurndownPoint } from "@/types/api";

/**
 * Geometry for the burndown chart. Pure — no React, no DOM — so the component
 * only draws what this returns. Same split as gantt/scale.ts.
 */
export interface BurndownGeometry {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  x: (iso: string) => number;
  y: (points: number) => number;
  /** "M…L…" from committed down to zero across the sprint. A reference, not data. */
  idealPath: string;
  /**
   * One path per unbroken run of days. A gap in the snapshots stays a gap: a
   * straight line across it would assert "no work happened", which is exactly
   * what the missing data can't tell us.
   */
  actualPaths: string[];
  dots: { cx: number; cy: number; point: BurndownPoint }[];
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  todayX: number | null;
  /** Scope changes: the day's total moved from the day before. */
  scopeChanges: { cx: number; cy: number; delta: number; date: string }[];
}

// The bottom pad carries the x-axis band, so the card never grows a nested
// scrollbar to reveal its own axis labels.
const PAD = { top: 10, right: 14, bottom: 26, left: 36 };
const DAY = 86_400_000;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function buildBurndown(
  data: Burndown,
  width = 680,
  height = 220,
): BurndownGeometry | null {
  if (!data.start_date || !data.end_date) return null;

  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: Math.max(1, width - PAD.left - PAD.right),
    h: Math.max(1, height - PAD.top - PAD.bottom),
  };

  const t0 = new Date(data.start_date).getTime();
  const t1 = new Date(data.end_date).getTime();
  const span = Math.max(DAY, t1 - t0);

  // Headroom, so scope added above the original commitment still has somewhere
  // to be drawn rather than being clipped at the top.
  const peak = Math.max(
    data.committed_points,
    data.total_points,
    ...data.points.map((p) => p.remaining_points),
    1,
  );
  const yMax = niceCeiling(peak);

  const x = (value: string) =>
    plot.x + ((new Date(value).getTime() - t0) / span) * plot.w;
  const y = (points: number) => plot.y + plot.h - (points / yMax) * plot.h;

  const idealPath = `M${x(data.start_date)},${y(data.committed_points)}L${x(
    data.end_date,
  )},${y(0)}`;

  // Split into runs of consecutive days so gaps render as gaps.
  const actualPaths: string[] = [];
  let run: BurndownPoint[] = [];
  const flush = () => {
    if (run.length === 1) {
      // A lone reading still deserves to be visible; its dot carries it, but a
      // zero-length path keeps the stroke consistent.
      const p = run[0];
      actualPaths.push(`M${x(p.date)},${y(p.remaining_points)}L${x(p.date)},${y(p.remaining_points)}`);
    } else if (run.length > 1) {
      actualPaths.push(
        run
          .map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.remaining_points)}`)
          .join(""),
      );
    }
    run = [];
  };
  for (const point of data.points) {
    const previous = run[run.length - 1];
    if (previous) {
      const gapDays =
        (new Date(point.date).getTime() - new Date(previous.date).getTime()) / DAY;
      if (gapDays > 1.5) flush();
    }
    run.push(point);
  }
  flush();

  const dots = data.points.map((point) => ({
    cx: x(point.date),
    cy: y(point.remaining_points),
    point,
  }));

  const scopeChanges: BurndownGeometry["scopeChanges"] = [];
  data.points.forEach((point, index) => {
    if (index === 0) return;
    const delta = round1(point.total_points - data.points[index - 1].total_points);
    if (delta !== 0) {
      scopeChanges.push({
        cx: x(point.date),
        cy: y(point.remaining_points),
        delta,
        date: point.date,
      });
    }
  });

  const today = iso(new Date());
  const inWindow = today >= data.start_date && today <= data.end_date;

  return {
    width,
    height,
    plot,
    x,
    y,
    idealPath,
    actualPaths,
    dots,
    xTicks: dateTicks(data.start_date, data.end_date, plot.w).map((d) => ({
      x: x(d),
      label: new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    })),
    yTicks: valueTicks(yMax).map((v) => ({ y: y(v), label: String(v) })),
    todayX: inWindow ? x(today) : null,
    scopeChanges,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Round the axis top to something a reader can do arithmetic with. */
function niceCeiling(value: number): number {
  if (value <= 5) return 5;
  // Finer steps than the usual 1/2/5 decade: with only 1/2/5 available, 28
  // rounds all the way up to 50 and the tallest mark ends up at half height.
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/** 4–5 clean gridlines including 0 and the top. */
function valueTicks(max: number): number[] {
  const target = 4;
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= raw)! * magnitude;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(round1(v));
  return out;
}

/** Date ticks at roughly 70px spacing, always including both ends. */
function dateTicks(start: string, end: string, pxWide: number): string[] {
  const t0 = new Date(start).getTime();
  const t1 = new Date(end).getTime();
  const days = Math.max(1, Math.round((t1 - t0) / DAY));
  const every = Math.max(1, Math.ceil(days / Math.max(2, Math.floor(pxWide / 70))));
  const out: string[] = [];
  for (let i = 0; i <= days; i += every) out.push(iso(new Date(t0 + i * DAY)));
  const last = iso(new Date(t1));
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
