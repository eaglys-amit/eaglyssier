import type { Velocity, VelocitySprint } from "@/types/api";

/** Geometry for the velocity chart. Pure, like burndown.ts. */
export interface VelocityGeometry {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  bars: {
    sprint: VelocitySprint;
    /** The completed-points column. */
    x: number;
    y: number;
    w: number;
    h: number;
    path: string;
    /** Where the commitment sat, as a cap rule over the bar. */
    targetY: number | null;
    /** Full-height transparent hit area, so hovering never needs precision. */
    hit: { x: number; y: number; w: number; h: number };
    label: string;
  }[];
  yTicks: { y: number; label: string }[];
  averageY: number | null;
  averageLabel: string;
}

const PAD = { top: 10, right: 14, bottom: 34, left: 36 };
// Bars are capped rather than filling their slot — the leftover band is air.
const MAX_BAR = 24;
// 2px of surface between neighbours does the separating; no strokes.
const GAP = 2;

export function buildVelocity(
  data: Velocity,
  width = 680,
  height = 220,
): VelocityGeometry | null {
  if (!data.sprints.length) return null;

  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: Math.max(1, width - PAD.left - PAD.right),
    h: Math.max(1, height - PAD.top - PAD.bottom),
  };

  const peak = Math.max(
    1,
    ...data.sprints.map((s) => Math.max(s.completed_points, s.committed_points)),
  );
  const yMax = niceCeiling(peak);
  const y = (points: number) => plot.y + plot.h - (points / yMax) * plot.h;

  const slot = plot.w / data.sprints.length;
  const barW = Math.min(MAX_BAR, Math.max(4, slot - GAP * 2));

  const bars = data.sprints.map((sprint, index) => {
    const centre = plot.x + slot * index + slot / 2;
    const x = centre - barW / 2;
    const top = y(sprint.completed_points);
    const h = Math.max(0, plot.y + plot.h - top);
    return {
      sprint,
      x,
      y: top,
      w: barW,
      h,
      // Rounded at the data end only; the baseline stays square.
      path: topRoundedBar(x, top, barW, h, 4),
      targetY:
        sprint.committed_points > 0 && sprint.committed_points !== sprint.completed_points
          ? y(sprint.committed_points)
          : null,
      hit: { x: plot.x + slot * index, y: plot.y, w: slot, h: plot.h },
      // Sprint names are long ("MOD6100 Sprint 12"); the trailing token is the
      // part that distinguishes them on a crowded axis.
      label: shortName(sprint.name),
    };
  });

  return {
    width,
    height,
    plot,
    bars,
    yTicks: valueTicks(yMax).map((v) => ({ y: y(v), label: String(v) })),
    averageY: data.average > 0 ? y(data.average) : null,
    averageLabel: `avg ${trim(data.average)}`,
  };
}

/**
 * A bar rounded only at the top. `<rect rx>` rounds all four corners, which
 * lifts the mark off its own baseline and misreads the zero point.
 */
export function topRoundedBar(
  x: number,
  y: number,
  w: number,
  h: number,
  r = 4,
): string {
  const radius = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return [
    `M${x},${y + h}`,
    `V${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `H${x + w - radius}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `V${y + h}`,
    "Z",
  ].join("");
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  // "MOD6100 Sprint 12" -> "S12"; "Sprint 21" -> "S21"; anything else truncates.
  const last = parts[parts.length - 1];
  if (/^\d+$/.test(last)) return `S${last}`;
  return name.length > 8 ? `${name.slice(0, 7)}…` : name;
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

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

function valueTicks(max: number): number[] {
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= raw)! * magnitude;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 10) / 10);
  return out;
}
