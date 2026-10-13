import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gauge, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { KpiStat } from "@/components/shared/KpiStat";
import { Spinner } from "@/components/shared/Spinner";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Kpi } from "@/types/api";


export function KpiDetailCard({ kpi }: { kpi: Kpi }) {
  const payload = kpi.kpi;
  const metrics = payload?.metrics ?? {};

  if (kpi.status === "running") {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Spinner /> Generating KPI for {kpi.display_name}…
        </CardContent>
      </Card>
    );
  }
  if (kpi.status === "failed") {
    return (
      <Card>
        <CardContent className="p-6">
          <ErrorAlert message={kpi.error || "KPI generation failed."} />
        </CardContent>
      </Card>
    );
  }
  if (!payload) {
    return (
      <EmptyState
        icon={Gauge}
        title="No KPI yet"
        hint={`Nothing generated for ${kpi.display_name} yet — press Generate KPI above.`}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          {kpi.display_name}
          {payload.rating ? <StatusBadge variant="accent" label={payload.rating} /> : null}
          {payload.score != null ? (
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {payload.score}/100
            </span>
          ) : null}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(kpi.generated_at)}
          {kpi.model ? ` · ${kpi.model}` : ""}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <KpiStat label="Commits" value={metrics.commits ?? "—"} />
          <KpiStat
            label="Tasks done"
            value={
              metrics.tasks_total != null
                ? `${metrics.tasks_done ?? 0}/${metrics.tasks_total}`
                : (metrics.tasks_done ?? "—")
            }
          />
          <KpiStat
            label="Story points"
            value={
              metrics.story_points_total != null
                ? `${metrics.story_points_completed ?? 0}/${metrics.story_points_total}`
                : (metrics.story_points_completed ?? "—")
            }
          />
          <KpiStat
            label="Completed / allocated"
            value={
              metrics.story_points_allocated
                ? `${metrics.story_points_completed ?? 0}/${metrics.story_points_allocated}`
                : (metrics.story_points_completed ?? "—")
            }
          />
          <KpiStat label="Hours logged" value={metrics.hours_logged ?? "—"} />
          <KpiStat
            label="Lines changed"
            value={
              <span>
                <span className="text-success">+{metrics.additions ?? 0}</span>{" "}
                <span className="text-destructive">−{metrics.deletions ?? 0}</span>
              </span>
            }
          />
          <KpiStat label="Reopened" value={metrics.reopened ?? "—"} />
        </div>

        {payload.summary ? <p className="text-sm">{payload.summary}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          {payload.strengths?.length ? (
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-success">
                Strengths
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {payload.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {payload.improvements?.length ? (
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-warning">
                Improvements
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {payload.improvements.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One member's KPI — the only place KPIs are generated: for this member, or
 * (tech leads / project managers) for everyone at once.
 */
export function KpiPanel({ projectId, kpi, allMemberIds, canGenerate, scopeSummary }: {
  projectId: number;
  kpi: Kpi;
  allMemberIds: number[];
  canGenerate: boolean;
  scopeSummary: ReactNode;
}) {
  const qc = useQueryClient();
  const generate = useMutation({
    mutationFn: (memberIds: number[]) =>
      api.post<Kpi[]>(`/projects/${projectId}/kpi`, { member_ids: memberIds }),
    onSuccess: (list, ids) => {
      qc.setQueryData(qk.kpi(projectId), list);
      toast.success(ids.length > 1 ? `KPI generation started for ${ids.length} members` : "KPI generation started");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start KPI generation"),
  });
  const running = kpi.status === "running";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {scopeSummary}
        {canGenerate ? (
          <div className="flex items-center gap-1.5">
            {allMemberIds.length > 1 ? (
              <Button size="sm" variant="outline" disabled={generate.isPending}
                      title="Each member's own data scope is applied"
                      onClick={() => generate.mutate(allMemberIds)}>
                Generate for everyone ({allMemberIds.length})
              </Button>
            ) : null}
            <Button size="sm" disabled={running || generate.isPending}
                    onClick={() => generate.mutate([kpi.member_id])}>
              <Sparkles className="size-4" />
              {running ? "Generating…" : kpi.kpi ? "Regenerate KPI" : "Generate KPI"}
            </Button>
          </div>
        ) : null}
      </div>
      <KpiDetailCard kpi={kpi} />
    </div>
  );
}
