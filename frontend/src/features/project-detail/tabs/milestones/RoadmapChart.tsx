import { formatDate, formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Milestone, Roadmap } from "@/types/api";

import { buildRoadmap, type MilestoneBar, type RoadmapGeometry } from "./roadmap";

/**
 * The roadmap canvas: milestone bars over a lane of sprint bands.
 *
 * Absolutely-positioned divs rather than SVG, matching GanttChart — the bars
 * carry text, and text in SVG can't be truncated with an ellipsis. Every colour
 * is a theme token, never a hex, so dark mode is automatic (the rule the
 * burndown and velocity charts follow).
 */

const MONTH_ROW_H = 22;
const DAY_ROW_H = 22;
const AXIS_H = MONTH_ROW_H + DAY_ROW_H;
const BAND_H = 28;
const ROW_H = 32;
const BAR_H = 14;
const LEFT_W = 240;

/** Bar fill by derived health. Tokens only — see the file docstring. */
function fillClass(health: Milestone["health"]): string {
  switch (health) {
    case "complete":
      return "bg-success/80";
    case "overdue":
      return "bg-destructive/80";
    case "at_risk":
      return "bg-warning/80";
    case "on_track":
      return "bg-primary/80";
    default:
      return "bg-muted-foreground/40";
  }
}

function barTooltip(m: Milestone): string {
  const pct = Math.round(m.progress * 100);
  const lines = [
    m.name,
    `${formatDate(m.start_date)} → ${formatDate(m.target_date)}`,
    `${pct}% · ${formatPoints(m.completed_points)} / ${formatPoints(m.total_points)} pts`,
  ];
  if (m.forecast_date) {
    const late = m.days_late ?? 0;
    lines.push(
      `Forecast ${formatDate(m.forecast_date)}` +
        (late > 0 ? ` (${late}d late)` : late < 0 ? ` (${-late}d early)` : ""),
    );
  }
  return lines.join("\n");
}

function MilestoneRow({
  bar,
  onOpen,
}: {
  bar: MilestoneBar;
  onOpen: (id: number) => void;
}) {
  const m = bar.milestone;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(m.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(m.id);
        }
      }}
      title={barTooltip(m)}
      className="relative cursor-pointer border-b border-border/40 hover:bg-accent/40"
      style={{ height: ROW_H }}
    >
      {/* The forecast tail. Drawn only when the projection actually slips. */}
      {bar.forecast ? (
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 border-t-2 border-dashed border-warning/70"
          style={{
            left: bar.forecast.from,
            width: Math.max(2, bar.forecast.to - bar.forecast.from),
          }}
        />
      ) : null}

      {/* Track + completed fill. */}
      <div
        className="absolute top-1/2 -translate-y-1/2 overflow-hidden rounded border border-border bg-muted"
        style={{ left: bar.left, width: bar.width, height: BAR_H }}
      >
        <div className={cn("h-full", fillClass(m.health))} style={{ width: bar.fillWidth }} />
      </div>

      {/* Target date: a rotated square, drawn last so a short bar can't hide it. */}
      {bar.targetX !== null ? (
        <div
          className="pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-background bg-foreground"
          style={{ left: bar.targetX }}
        />
      ) : null}
    </div>
  );
}

export function RoadmapChart({
  data,
  onOpenMilestone,
  onOpenSprint,
}: {
  data: Roadmap;
  onOpenMilestone: (id: number) => void;
  onOpenSprint: (id: number) => void;
}) {
  const geo: RoadmapGeometry | null = buildRoadmap(data);
  if (!geo) return null;
  const { scale, bars, bands, todayX } = geo;
  const hasBands = bands.length > 0;

  return (
    <div className="flex overflow-hidden rounded-lg border">
      {/* Left column: labels, fixed while the timeline scrolls. */}
      <div className="shrink-0 border-r bg-background" style={{ width: LEFT_W }}>
        <div className="border-b bg-muted/40" style={{ height: AXIS_H }} />
        {hasBands ? (
          <div
            className="flex items-center border-b border-border bg-muted/40 px-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            style={{ height: BAND_H }}
          >
            Sprints
          </div>
        ) : null}
        {bars.map((bar) => {
          const m = bar.milestone;
          return (
            <div
              key={m.id}
              role="button"
              onClick={() => onOpenMilestone(m.id)}
              title={m.name}
              className="flex cursor-pointer items-center justify-between gap-2 border-b border-border/40 px-3 hover:bg-accent/50"
              style={{ height: ROW_H }}
            >
              <span className="truncate text-xs font-medium">{m.name}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {Math.round(m.progress * 100)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Right column: scrollable timeline. */}
      <div className="flex-1 overflow-x-auto">
        <div style={{ width: scale.totalWidth }}>
          {/* Two-row axis: months on top, dates below. */}
          <div className="relative border-b bg-muted/40" style={{ height: AXIS_H }}>
            <div className="absolute inset-x-0 top-0" style={{ height: MONTH_ROW_H }}>
              {scale.months.map((mo, i) => (
                <div key={i}>
                  {mo.x >= 0 ? (
                    <div
                      className="absolute top-0 border-l border-border/60"
                      style={{ left: mo.x, height: MONTH_ROW_H }}
                    />
                  ) : null}
                  <span
                    className="absolute top-1 text-[11px] font-medium text-foreground/70"
                    style={{ left: Math.max(4, mo.x + 4) }}
                  >
                    {mo.label}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="absolute inset-x-0 border-t border-border/40"
              style={{ top: MONTH_ROW_H, height: DAY_ROW_H }}
            >
              {scale.days.map((d, i) => (
                <div
                  key={i}
                  className="absolute top-0 border-l border-border/50"
                  style={{ left: d.x, height: DAY_ROW_H }}
                >
                  <span className="ml-1 text-[10px] text-muted-foreground">{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Body: gridlines, today rule, sprint lane, milestone rows. */}
          <div className="relative">
            {scale.days.map((d, i) => (
              <div
                key={`d${i}`}
                className="pointer-events-none absolute top-0 h-full border-l border-border/20"
                style={{ left: d.x }}
              />
            ))}
            <div
              className="pointer-events-none absolute top-0 z-10 h-full border-l-2 border-dashed border-primary/60"
              style={{ left: todayX }}
              title="Today"
            />

            {hasBands ? (
              <div className="relative border-b border-border" style={{ height: BAND_H }}>
                {bands.map((band) => {
                  const active = (band.sprint.state || "").toLowerCase() === "active";
                  return (
                    <div
                      key={band.sprint.sprint_id}
                      role="button"
                      onClick={() => onOpenSprint(band.sprint.sprint_id)}
                      title={`${band.sprint.name}\n${formatDate(band.sprint.start_date)} → ${formatDate(band.sprint.end_date)}${band.sprint.state ? "\n" + band.sprint.state : ""}\nOpen in Scrums`}
                      className={cn(
                        "absolute top-1/2 flex -translate-y-1/2 cursor-pointer items-center overflow-hidden rounded border px-1.5 hover:brightness-110",
                        active ? "border-primary/50 bg-primary/10" : "border-border bg-muted",
                      )}
                      style={{ left: band.left, width: band.width, height: BAR_H + 2 }}
                    >
                      <span className="truncate text-[10px] font-medium text-muted-foreground">
                        {band.sprint.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {bars.map((bar) => (
              <MilestoneRow key={bar.milestone.id} bar={bar} onOpen={onOpenMilestone} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
