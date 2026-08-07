import { useState } from "react";

import { formatDate, formatPoints } from "@/lib/format";
import type { Burndown } from "@/types/api";

import { buildBurndown } from "./burndown";
import { useElementWidth } from "./useElementWidth";

const HEIGHT = 220;

/**
 * Remaining story points over the sprint, against the ideal line.
 *
 * One data series in one hue. The ideal is a *reference*, so it's a dashed
 * hairline in a neutral — dashing legitimately means "projection/threshold"
 * here, which is why the gridlines stay solid.
 */
export function BurndownChart({ data }: { data: Burndown }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width } = useElementWidth();
  const g = buildBurndown(data, width, HEIGHT);

  if (!g) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        This sprint has no start and end date, so there's no timeline to plot.
      </p>
    );
  }
  if (!g.dots.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No daily readings yet. One is recorded each day the sprint is active.
      </p>
    );
  }

  const active = hover != null ? g.dots[hover] : null;

  return (
    <div className="relative" ref={ref}>
      <svg
        width={g.width}
        height={g.height}
        // No viewBox: geometry is already in CSS pixels (see useElementWidth),
        // so nothing is scaled and the strokes stay exactly 1px/2px.
        className="block"
        role="img"
        aria-label={`Burndown for ${data.sprint_name}: ${formatPoints(
          data.remaining_points,
        )} of ${formatPoints(data.committed_points)} points remaining`}
        onPointerLeave={() => setHover(null)}
      >
        {/* Gridlines: solid hairlines one step off the surface. Never dashed —
            dashing would read as a threshold. */}
        {g.yTicks.map((tick) => (
          <line
            key={`grid-${tick.label}`}
            x1={g.plot.x}
            x2={g.plot.x + g.plot.w}
            y1={tick.y}
            y2={tick.y}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {g.yTicks.map((tick) => (
          <text
            key={`ylab-${tick.label}`}
            x={g.plot.x - 6}
            y={tick.y + 3}
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[9px] tabular-nums"
          >
            {tick.label}
          </text>
        ))}
        {g.xTicks.map((tick, index) => (
          <text
            key={`xlab-${tick.label}`}
            x={tick.x}
            y={g.plot.y + g.plot.h + 16}
            // The first and last labels anchor inward; centred, they'd overflow
            // the SVG and get clipped mid-word at the edges.
            textAnchor={
              index === 0 ? "start" : index === g.xTicks.length - 1 ? "end" : "middle"
            }
            className="fill-muted-foreground font-mono text-[9px] tabular-nums"
          >
            {tick.label}
          </text>
        ))}

        {/* Today, when the sprint is in flight. */}
        {g.todayX != null ? (
          <line
            x1={g.todayX}
            x2={g.todayX}
            y1={g.plot.y}
            y2={g.plot.y + g.plot.h}
            className="stroke-muted-foreground/40"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {/* The ideal line — a reference, hence dashed and neutral. */}
        <path
          d={g.idealPath}
          fill="none"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          strokeLinecap="round"
          className="stroke-muted-foreground"
          vectorEffect="non-scaling-stroke"
        />

        {/* The one data series. A gap in the readings is drawn as a gap. */}
        {g.actualPaths.map((d, i) => (
          <path
            key={`actual-${i}`}
            d={d}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-primary"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Scope changes: the day the sprint's total moved. */}
        {g.scopeChanges.map((change) => (
          <circle
            key={`scope-${change.date}`}
            cx={change.cx}
            cy={change.cy}
            r={5}
            className="fill-none stroke-primary"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Crosshair on the hovered day. */}
        {active ? (
          <line
            x1={active.cx}
            x2={active.cx}
            y1={g.plot.y}
            y2={g.plot.y + g.plot.h}
            className="stroke-muted-foreground"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {/* Markers with a 2px surface ring so they stay legible on the line. */}
        {g.dots.map((dot, index) => (
          <circle
            key={`dot-${dot.point.date}`}
            cx={dot.cx}
            cy={dot.cy}
            r={index === hover ? 5 : 4}
            className="fill-primary stroke-card"
            strokeWidth={2}
          />
        ))}

        {/* Endpoint value, labelled selectively — never one per point. */}
        {g.dots.length ? (
          <text
            x={g.dots[g.dots.length - 1].cx}
            y={g.dots[g.dots.length - 1].cy - 9}
            textAnchor="end"
            className="fill-foreground font-mono text-[10px] tabular-nums"
          >
            {formatPoints(g.dots[g.dots.length - 1].point.remaining_points)}
          </text>
        ) : null}

        {/* Hit bands: the pointer only has to be nearest, not on the 4px dot. */}
        {g.dots.map((dot, index) => {
          const half = Math.max(12, g.plot.w / Math.max(1, g.dots.length) / 2);
          return (
            <rect
              key={`hit-${dot.point.date}`}
              x={dot.cx - half}
              y={g.plot.y}
              width={half * 2}
              height={g.plot.h}
              fill="transparent"
              onPointerEnter={() => setHover(index)}
            />
          );
        })}
      </svg>

      {active ? (
        <Tooltip
          x={(active.cx / g.width) * 100}
          date={active.point.date}
          remaining={active.point.remaining_points}
          completed={active.point.completed_points}
          total={active.point.total_points}
          backfilled={active.point.backfilled}
        />
      ) : null}
    </div>
  );
}

/** Value leads, label follows — the reader has the day and wants the number. */
function Tooltip({
  x,
  date,
  remaining,
  completed,
  total,
  backfilled,
}: {
  x: number;
  date: string;
  remaining: number;
  completed: number;
  total: number;
  backfilled: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-md"
      style={{ left: `${Math.min(88, Math.max(12, x))}%` }}
    >
      <div className="mb-0.5 text-muted-foreground">{formatDate(date)}</div>
      <div className="flex items-center gap-1.5">
        <svg width="12" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="12" y2="3" strokeWidth="2" className="stroke-primary" />
        </svg>
        <span className="font-mono font-medium tabular-nums">{formatPoints(remaining)}</span>
        <span className="text-muted-foreground">remaining</span>
      </div>
      <div className="text-muted-foreground">
        <span className="font-mono tabular-nums">{formatPoints(completed)}</span> done of{" "}
        <span className="font-mono tabular-nums">{formatPoints(total)}</span>
      </div>
      {backfilled ? (
        <div className="mt-0.5 text-warning">reconstructed, not sampled</div>
      ) : null}
    </div>
  );
}
