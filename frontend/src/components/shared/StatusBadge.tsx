import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { JobStatus, ReportStatus, StatusCategory, SyncRunStatus } from "@/types/api";

type Variant = "success" | "running" | "failed" | "neutral" | "accent" | "warning";

const VARIANT_CLASSES: Record<Variant, string> = {
  success:
    "bg-success/10 text-success border-success/20 dark:bg-success/15",
  running:
    "bg-primary/10 text-primary border-primary/20 dark:bg-primary/15",
  failed:
    "bg-destructive/10 text-destructive border-destructive/20 dark:bg-destructive/15",
  warning:
    "bg-warning/10 text-warning border-warning/25 dark:bg-warning/15",
  neutral: "bg-muted text-muted-foreground border-border",
  accent: "bg-accent text-accent-foreground border-border",
};

export function StatusBadge({
  variant,
  label,
  spinning,
  className,
}: {
  variant: Variant;
  label: string;
  spinning?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {spinning ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <span className="size-1.5 rounded-full bg-current" />
      )}
      {label}
    </span>
  );
}

export function jobBadge(status: JobStatus, labels?: Partial<Record<JobStatus, string>>) {
  const label = labels?.[status];
  switch (status) {
    case "running":
      return <StatusBadge variant="running" label={label ?? "Running"} spinning />;
    case "ready":
    case "done":
      return <StatusBadge variant="success" label={label ?? "Ready"} />;
    case "failed":
      return <StatusBadge variant="failed" label={label ?? "Failed"} />;
    default:
      return <StatusBadge variant="neutral" label={label ?? "Not run"} />;
  }
}

export function syncRunBadge(status: SyncRunStatus) {
  switch (status) {
    case "running":
      return <StatusBadge variant="running" label="Syncing" spinning />;
    case "success":
      return <StatusBadge variant="success" label="Success" />;
    case "failed":
      return <StatusBadge variant="failed" label="Failed" />;
  }
}

export function reportBadge(status: ReportStatus) {
  switch (status) {
    case "pending":
      return <StatusBadge variant="running" label="Queued" spinning />;
    case "generating":
      return <StatusBadge variant="running" label="Generating" spinning />;
    case "ready":
      return <StatusBadge variant="success" label="Ready" />;
    case "failed":
      return <StatusBadge variant="failed" label="Failed" />;
  }
}

export function taskCategoryBadge(category: StatusCategory, label?: string | null) {
  switch (category) {
    case "done":
      return <StatusBadge variant="success" label={label ?? "Done"} />;
    case "in_progress":
      return <StatusBadge variant="warning" label={label ?? "In progress"} />;
    default:
      return <StatusBadge variant="neutral" label={label ?? "To do"} />;
  }
}
