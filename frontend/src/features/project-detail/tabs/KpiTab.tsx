import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Sparkles } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { KpiStat } from "@/components/shared/KpiStat";
import { Spinner } from "@/components/shared/Spinner";
import { jobBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { Kpi } from "@/types/api";

import { TabShell } from "@/features/project-detail/TabShell";

function KpiDetailCard({ kpi }: { kpi: Kpi }) {
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
        hint={`Select ${kpi.display_name} on the left and press Generate.`}
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

export function KpiTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: kpis } = useQuery({
    queryKey: qk.kpi(projectId),
    queryFn: () => api.get<Kpi[]>(`/projects/${projectId}/kpi`),
    refetchInterval: (q) =>
      q.state.data?.some((k) => k.status === "running") ? 2000 : false,
  });

  const generate = useMutation({
    mutationFn: (memberIds: number[]) =>
      api.post<Kpi[]>(`/projects/${projectId}/kpi`, { member_ids: memberIds }),
    onSuccess: (list) => {
      qc.setQueryData(qk.kpi(projectId), list);
      toast.success("KPI generation started");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start KPI generation"),
  });

  if (kpis && !kpis.length) {
    return (
      <TabShell tab="kpi">
        <EmptyState
          icon={Gauge}
          title="No members on this project"
          hint="Add members under Members in the sidebar first, then generate per-member KPIs here."
        />
      </TabShell>
    );
  }

  const activeId = Number(params.get("member")) || kpis?.[0]?.member_id || null;
  const active = kpis?.find((k) => k.member_id === activeId) ?? null;
  const allSelected = kpis?.length ? selected.size === kpis.length : false;

  return (
    <TabShell tab="kpi">
      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2 pt-0">
            <label className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) =>
                  setSelected(v === true ? new Set(kpis?.map((k) => k.member_id)) : new Set())
                }
              />
              Select all
            </label>
            {(kpis ?? []).map((k) => (
              <div
                key={k.member_id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                  k.member_id === activeId ? "bg-accent" : "hover:bg-accent/50",
                )}
                onClick={() => {
                  params.set("member", String(k.member_id));
                  setParams(params, { replace: true });
                }}
              >
                <Checkbox
                  checked={selected.has(k.member_id)}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(v) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (v === true) next.add(k.member_id);
                      else next.delete(k.member_id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate text-sm">{k.display_name}</span>
                {jobBadge(k.status, { none: "—", ready: "Ready", running: "…" })}
              </div>
            ))}
            <div className="p-2">
              <Button
                className="w-full"
                size="sm"
                disabled={selected.size === 0 || generate.isPending}
                onClick={() => generate.mutate([...selected])}
              >
                <Sparkles className="size-4" />
                Generate {selected.size ? `(${selected.size})` : ""}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Each member's saved data scope (sprints/repos/dates) from the Data tab is applied.
              </p>
            </div>
          </CardContent>
        </Card>

        {active ? (
          <KpiDetailCard kpi={active} />
        ) : (
          <EmptyState icon={Gauge} title="Select a member" />
        )}
      </div>
    </TabShell>
  );
}
