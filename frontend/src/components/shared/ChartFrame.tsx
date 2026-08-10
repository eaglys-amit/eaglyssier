import { BarChart3, Table as TableIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for a chart: title, legend, and a table view of the same
 * numbers. Used by the Scrums burndown/velocity charts and the Milestones
 * roadmap.
 *
 * The table isn't a nicety — it's the accessible twin. Nothing a chart shows may
 * be reachable *only* by hovering, and a colour-encoded plot needs a
 * WCAG-clean equivalent. It also happens to be the thing people screenshot.
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  /** Held at reduced opacity while refetching — no skeleton, no layout jump. */
  stale = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Omit for a single-series chart: the title already names what's plotted. */
  legend?: ReactNode;
  table: ReactNode;
  stale?: boolean;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {subtitle ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {legend}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
          >
            {asTable ? <BarChart3 className="size-3.5" /> : <TableIcon className="size-3.5" />}
            <span className="sr-only">{asTable ? "Show the chart" : "Show the numbers"}</span>
          </Button>
        </div>
      </div>
      <div className={cn("p-3 transition-opacity", stale && "opacity-60")}>
        {asTable ? table : children}
      </div>
    </div>
  );
}

/**
 * A legend key. Mirrors the mark it stands for — a line for a line series, a
 * block for a bar — and the label wears a text token, never the data colour.
 */
export function LegendKey({
  kind,
  className,
  label,
}: {
  kind: "line" | "dashed" | "bar" | "rule";
  /** Tailwind colour class for the swatch only. */
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {kind === "bar" ? (
        <span className={cn("size-2.5 rounded-sm", className)} />
      ) : (
        <svg width="16" height="8" aria-hidden="true">
          <line
            x1="0"
            y1="4"
            x2="16"
            y2="4"
            strokeWidth={kind === "rule" ? 2 : 2}
            strokeDasharray={kind === "dashed" ? "3 3" : undefined}
            className={className}
            strokeLinecap="round"
          />
        </svg>
      )}
      {label}
    </span>
  );
}
