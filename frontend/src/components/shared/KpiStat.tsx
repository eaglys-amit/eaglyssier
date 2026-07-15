import type { ReactNode } from "react";

export function KpiStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums tracking-tight">
        {value}
      </div>
    </div>
  );
}
