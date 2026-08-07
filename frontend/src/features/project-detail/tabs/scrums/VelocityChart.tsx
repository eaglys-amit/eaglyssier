import { useState } from "react";

import { formatPoints } from "@/lib/format";
import type { Velocity } from "@/types/api";

import { buildVelocity } from "./velocity";
import { useElementWidth } from "./useElementWidth";

const HEIGHT = 220;

/**
 * Completed points per sprint.
 *
 * One bar per sprint, not grouped bars: the story is throughput, and the
 * commitment is a *target* the bar is measured against — drawn as a cap rule so
 * "did we hit it" is one visual comparison instead of a mental subtraction
 * between two adjacent bars.
 */
export function VelocityChart({ data }: { data: Velocity }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width } = useElementWidth();
  const g = buildVelocity(data, width, HEIGHT);

  if (!g) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No started sprints yet — velocity needs at least one to measure.
      </p>
    );
  }

  const active = hover != null ? g.bars[hover] : null;

  return (
    <div className="relative" ref={ref}>
      <svg
        width={g.width}
        height={g.height}
        className="block"
        role="img"
        aria-label={`Velocity across ${data.sprints.length} sprints, averaging ${formatPoints(
          data.average,
        )} points per closed sprint`}
        onPointerLeave={() => setHover(null)}
      >
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

        {/* The columns: one hue, capped width, rounded at the data end only. */}
        {g.bars.map((bar, index) => (
          <path
            key={`bar-${bar.sprint.sprint_id}`}
            d={bar.path}
            className={
              bar.sprint.state === "active"
                ? // In flight, so the number is partial: a wash rather than a
                  // solid fill, so it doesn't read as a finished result.
                  "fill-primary/30"
                : index === hover
                  ? "fill-primary/80"
                  : "fill-primary"
            }
          />
        ))}

        {/* Commitment target, as a cap rule over its own bar. */}
        {g.bars.map((bar) =>
          bar.targetY != null ? (
            <line
              key={`target-${bar.sprint.sprint_id}`}
              x1={bar.x - 2}
              x2={bar.x + bar.w + 2}
              y1={bar.targetY}
              y2={bar.targetY}
              className="stroke-muted-foreground"
              strokeWidth={2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}

        {/* The average across closed sprints — solid, because it's a fact, not
            a projection. */}
        {g.averageY != null ? (
          <>
            <line
              x1={g.plot.x}
              x2={g.plot.x + g.plot.w}
              y1={g.averageY}
              y2={g.averageY}
              className="stroke-foreground/40"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={g.plot.x + g.plot.w}
              y={g.averageY - 5}
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[9px] tabular-nums"
            >
              {g.averageLabel}
            </text>
          </>
        ) : null}

        {g.bars.map((bar, index) => (
          <text
            key={`xlab-${bar.sprint.sprint_id}`}
            x={bar.x + bar.w / 2}
            y={g.plot.y + g.plot.h + 16}
            textAnchor={
              index === 0 ? "start" : index === g.bars.length - 1 ? "end" : "middle"
            }
            className="fill-muted-foreground font-mono text-[9px] tabular-nums"
          >
            {bar.label}
          </text>
        ))}

        {/* The mark is the hit target, widened to its whole slot. */}
        {g.bars.map((bar, index) => (
          <rect
            key={`hit-${bar.sprint.sprint_id}`}
            x={bar.hit.x}
            y={bar.hit.y}
            width={bar.hit.w}
            height={bar.hit.h}
            fill="transparent"
            onPointerEnter={() => setHover(index)}
          />
        ))}
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-md"
          style={{
            left: `${Math.min(88, Math.max(12, ((active.x + active.w / 2) / g.width) * 100))}%`,
          }}
        >
          <div className="mb-0.5 text-muted-foreground">{active.sprint.name}</div>
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" />
            <span className="font-mono font-medium tabular-nums">
              {formatPoints(active.sprint.completed_points)}
            </span>
            <span className="text-muted-foreground">completed</span>
          </div>
          <div className="text-muted-foreground">
            <span className="font-mono tabular-nums">
              {formatPoints(active.sprint.committed_points)}
            </span>{" "}
            committed
            {active.sprint.state === "active" ? " · still in flight" : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}
