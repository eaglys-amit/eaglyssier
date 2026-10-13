import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";
import type { ChangeState, RequirementStatus, SpecCoverage } from "@/types/api";

export const STATUS_LABELS: Record<RequirementStatus, string> = {
  untraced: "Untraced",
  planned: "Planned",
  in_progress: "In progress",
  implemented: "Implemented",
  verified: "Verified",
  removed: "Removed",
};

export function requirementStatusBadge(status: RequirementStatus) {
  const variant = (
    {
      untraced: "warning",
      planned: "neutral",
      in_progress: "running",
      implemented: "success",
      verified: "success",
      removed: "neutral",
    } as const
  )[status];
  return <StatusBadge variant={variant} label={STATUS_LABELS[status]} />;
}

export function changeBadge(state: ChangeState, version: number | null) {
  if (state === "unchanged") return null;
  const label = { added: "New", changed: "Changed", removed: "Removed" }[state];
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        state === "removed"
          ? "border-border text-muted-foreground"
          : "border-warning/40 bg-warning/10 text-warning",
      )}
      title={version ? `In version ${version}` : undefined}
    >
      {label}
      {version ? ` · v${version}` : ""}
    </span>
  );
}

function pct(n: number, total: number) {
  return total ? Math.round((n / total) * 100) : 0;
}

/**
 * Linked / implemented / verified as three stacked meters. Text carries every
 * number, so the bars are decoration for the eye, not the only way to read it.
 */
export function CoverageBars({ coverage, compact = false }: { coverage: SpecCoverage; compact?: boolean }) {
  const rows = [
    { label: "Linked to work", value: coverage.linked, fill: "bg-primary/50" },
    { label: "Implemented", value: coverage.implemented, fill: "bg-primary" },
    { label: "Verified", value: coverage.verified, fill: "bg-success" },
  ];
  return (
    <div className={cn("space-y-1", compact ? "min-w-44" : "")}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className={cn("shrink-0 text-muted-foreground", compact ? "w-24" : "w-28")}>
            {r.label}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", r.fill)}
              style={{ width: `${pct(r.value, coverage.total)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono tabular-nums">
            {r.value}/{coverage.total}
          </span>
        </div>
      ))}
    </div>
  );
}
