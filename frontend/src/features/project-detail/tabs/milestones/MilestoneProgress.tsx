import { cn } from "@/lib/utils";
import type { MilestoneHealth } from "@/types/api";

/**
 * A compact completion meter for a table cell.
 *
 * Hand-rolled because there is no Progress primitive in components/ui — the
 * same reason CommitmentMeter is. Carries a real ARIA progressbar role so the
 * bar isn't the only way to read the number.
 */

const FILL: Record<MilestoneHealth, string> = {
  complete: "bg-success",
  on_track: "bg-primary",
  at_risk: "bg-warning",
  overdue: "bg-destructive",
  unknown: "bg-muted-foreground/50",
};

export function MilestoneProgress({
  progress,
  health,
  className,
}: {
  /** 0..1. */
  progress: number;
  health: MilestoneHealth;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full", FILL[health])} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}
