import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

import { formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Planned points against the sprint's team capacity.
 *
 * Capacity comes from the Capacity tab (focus factor x working days). When
 * nobody has a focus factor set it is *unknown*, not zero — showing a full red
 * bar for "we haven't told you our capacity yet" would be a lie, so that case
 * renders as a plain total with a link to go set it.
 */
export function CommitmentMeter({
  projectId,
  committed,
  completed,
  capacity,
  unestimated,
}: {
  projectId: number;
  committed: number;
  completed: number;
  capacity: number | null;
  unestimated: number;
}) {
  if (capacity === null) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {formatPoints(committed)} pts planned · {formatPoints(completed)} done
        </span>
        <Link
          to={`/projects/${projectId}/capacity`}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Set capacity to see how full this sprint is
        </Link>
        <UnestimatedNote count={unestimated} />
      </div>
    );
  }

  const over = committed > capacity;
  // Both bars are measured against the same scale so they stay comparable; when
  // over-committed that scale is the commitment itself, which is what makes the
  // overflow read as overflow rather than as a full bar.
  const scale = Math.max(capacity, committed) || 1;
  const capacityPct = (capacity / scale) * 100;
  const committedPct = (committed / scale) * 100;
  const completedPct = (Math.min(completed, scale) / scale) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono tabular-nums">
          <span className={cn("font-medium", over ? "text-destructive" : "text-foreground")}>
            {formatPoints(committed)}
          </span>
          <span className="text-muted-foreground"> / {formatPoints(capacity)} pts</span>
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {formatPoints(completed)} done
        </span>
        {over ? (
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertTriangle className="size-3.5" />
            Over capacity by {formatPoints(committed - capacity)}
          </span>
        ) : null}
        <UnestimatedNote count={unestimated} />
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        {/* Planned. */}
        <div
          className={cn("absolute inset-y-0 left-0", over ? "bg-destructive/30" : "bg-primary/30")}
          style={{ width: `${committedPct}%` }}
        />
        {/* Completed, drawn over planned so the two read as a fill and its progress. */}
        <div
          className="absolute inset-y-0 left-0 bg-success"
          style={{ width: `${completedPct}%` }}
        />
        {/* The capacity line only means something while there's overflow past it. */}
        {over ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/60"
            style={{ left: `${capacityPct}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

function UnestimatedNote({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="text-muted-foreground">
      {count} unestimated — the total is lower than the real scope
    </span>
  );
}
