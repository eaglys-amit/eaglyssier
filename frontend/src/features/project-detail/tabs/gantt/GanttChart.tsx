import { useSearchParams } from "react-router-dom";

import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, shortSha } from "@/lib/format";
import type { GanttItem, GanttOut, GanttRow, GanttSprint } from "@/types/api";

import { buildScale } from "./scale";

const MONTH_ROW_H = 22;
const WEEK_ROW_H = 22;
const AXIS_H = MONTH_ROW_H + WEEK_ROW_H;
const SPRINT_H = 28;
const MEMBER_H = 34;
const ITEM_H = 30;
const LEFT_W = 260;
const BAR_H = 14;
const MIN_BAR = 6;

type Scale = ReturnType<typeof buildScale>;

/** Tailwind classes for a task bar, keyed by kind + Jira status category. */
function barClass(item: GanttItem): string {
  if (item.kind === "commit") {
    return "border border-dashed border-primary/50 bg-primary/15";
  }
  switch (item.status_category) {
    case "done":
      return "bg-success/80 border border-success/30";
    case "in_progress":
      return "bg-warning/80 border border-warning/30";
    default:
      return "bg-muted-foreground/30 border border-border";
  }
}

function ItemRow({
  item,
  scale,
  onOpen,
}: {
  item: GanttItem;
  scale: Scale;
  onOpen: (item: GanttItem) => void;
}) {
  const left = scale.x(item.start);
  const width = Math.max(MIN_BAR, scale.x(item.end) - left);
  const clickable =
    (item.kind === "jira" && item.task_id != null) ||
    (item.kind === "commit" && item.commits.length > 0);
  const tooltip =
    `${item.key ? item.key + " · " : ""}${item.title}\n` +
    `${formatDate(item.start)} → ${formatDate(item.end)}` +
    (item.commits.length ? `\n${item.commits.length} commit(s)` : "");

  return (
    <div className="relative border-b border-border/40" style={{ height: ITEM_H }}>
      <div
        role={clickable ? "button" : undefined}
        title={tooltip}
        onClick={clickable ? () => onOpen(item) : undefined}
        className={cn(
          "absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded px-1.5",
          barClass(item),
          clickable && "cursor-pointer hover:brightness-110",
        )}
        style={{ left, width, height: BAR_H }}
      >
        {width > 46 ? (
          <span className="truncate text-[10px] font-medium leading-none text-foreground/80">
            {item.key}
          </span>
        ) : null}
      </div>
      {/* Commit markers positioned by authored time. */}
      {item.commits.map((c) =>
        c.authored_at ? (
          <span
            key={c.id}
            title={`${shortSha(c.sha)} · ${formatDateTime(c.authored_at)}${c.summary ? "\n" + c.summary : ""}`}
            className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-1 ring-background"
            style={{ left: scale.x(c.authored_at) }}
          />
        ) : null,
      )}
    </div>
  );
}

function MemberBlock({
  row,
  scale,
  onOpen,
}: {
  row: GanttRow;
  scale: Scale;
  onOpen: (item: GanttItem) => void;
}) {
  return (
    <div>
      <div
        className="flex items-center border-b border-border bg-muted/40 px-3 text-xs font-semibold"
        style={{ height: MEMBER_H, width: scale.totalWidth }}
      >
        {/* empty — the label lives in the left column; this keeps row heights aligned */}
      </div>
      {row.items.map((item) => (
        <ItemRow key={item.id} item={item} scale={scale} onOpen={onOpen} />
      ))}
    </div>
  );
}

/** Colored band for a sprint in the sprint lane. */
function SprintBar({ sprint, scale }: { sprint: GanttSprint; scale: Scale }) {
  const left = scale.x(sprint.start);
  const width = Math.max(MIN_BAR, scale.x(sprint.end) - left);
  const active = (sprint.state || "").toLowerCase() === "active";
  return (
    <div
      title={`${sprint.name}\n${formatDate(sprint.start)} → ${formatDate(sprint.end)}${sprint.state ? "\n" + sprint.state : ""}`}
      className={cn(
        "absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded border px-1.5",
        active ? "border-primary/50 bg-primary/10" : "border-border bg-muted",
      )}
      style={{ left, width, height: BAR_H + 4 }}
    >
      <span className="truncate text-[10px] font-medium text-muted-foreground">{sprint.name}</span>
    </div>
  );
}

export function GanttChart({ data }: { data: GanttOut }) {
  const [params, setParams] = useSearchParams();

  const scale = buildScale(data.range_start!, data.range_end!);
  const sprints = data.sprints;
  const hasSprints = sprints.length > 0;

  const openItem = (item: GanttItem) => {
    if (item.kind === "jira" && item.task_id != null) {
      params.set("task", String(item.task_id));
      params.delete("commit");
    } else if (item.kind === "commit" && item.commits[0]) {
      params.set("commit", String(item.commits[0].id));
      params.delete("task");
    } else {
      return;
    }
    setParams(params, { replace: false });
  };

  return (
    <div className="flex overflow-hidden rounded-lg border">
      {/* Left column: member + task labels (fixed while the timeline scrolls). */}
      <div className="shrink-0 border-r bg-background" style={{ width: LEFT_W }}>
        <div className="border-b bg-muted/40" style={{ height: AXIS_H }} />
        {hasSprints ? (
          <div
            className="flex items-center border-b border-border bg-muted/40 px-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            style={{ height: SPRINT_H }}
          >
            Sprints
          </div>
        ) : null}
        {data.rows.map((row) => (
          <div key={row.member_id ?? "unassigned"}>
            <div
              className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3"
              style={{ height: MEMBER_H }}
            >
              <span className="truncate text-xs font-semibold">{row.display_name}</span>
              <span className="text-[10px] text-muted-foreground">{row.items.length}</span>
            </div>
            {row.items.map((item) => (
              <div
                key={item.id}
                role="button"
                onClick={() => openItem(item)}
                className="flex cursor-pointer items-center gap-1.5 border-b border-border/40 px-3 hover:bg-accent/50"
                style={{ height: ITEM_H }}
                title={item.title}
              >
                <span
                  className={cn(
                    "shrink-0 font-mono text-[10px]",
                    item.kind === "jira" ? "text-muted-foreground" : "text-primary",
                  )}
                  title={item.kind === "jira" ? "Jira task" : "Commit (no matching task)"}
                >
                  {item.key}
                </span>
                <span className="truncate text-xs">{item.title}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Right column: scrollable timeline. */}
      <div className="flex-1 overflow-x-auto">
        <div style={{ width: scale.totalWidth }}>
          {/* Two-row axis header: months on top, weeks below. */}
          <div className="relative border-b bg-muted/40" style={{ height: AXIS_H }}>
            {/* Month row */}
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
            {/* Day row */}
            <div
              className="absolute inset-x-0 border-t border-border/40"
              style={{ top: MONTH_ROW_H, height: WEEK_ROW_H }}
            >
              {scale.days.map((d, i) => (
                <div
                  key={i}
                  className="absolute top-0 border-l border-border/50"
                  style={{ left: d.x, height: WEEK_ROW_H }}
                >
                  <span className="ml-1 text-[10px] text-muted-foreground">{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Body: gridlines + optional sprint lane + member rows. */}
          <div className="relative">
            {/* Date gridlines (subtle). */}
            {scale.days.map((d, i) => (
              <div
                key={`d${i}`}
                className="pointer-events-none absolute top-0 h-full border-l border-border/20"
                style={{ left: d.x }}
              />
            ))}
            {/* Sprint boundary lines (accent, dashed) spanning the whole body. */}
            {sprints.map((s) => (
              <div key={`s${s.id}`}>
                <div
                  className="pointer-events-none absolute top-0 h-full border-l border-dashed border-primary/40"
                  style={{ left: scale.x(s.start) }}
                />
                <div
                  className="pointer-events-none absolute top-0 h-full border-l border-dashed border-primary/40"
                  style={{ left: scale.x(s.end) }}
                />
              </div>
            ))}

            {hasSprints ? (
              <div className="relative border-b border-border" style={{ height: SPRINT_H }}>
                {sprints.map((s) => (
                  <SprintBar key={s.id} sprint={s} scale={scale} />
                ))}
              </div>
            ) : null}

            {data.rows.map((row) => (
              <MemberBlock
                key={row.member_id ?? "unassigned"}
                row={row}
                scale={scale}
                onOpen={openItem}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
