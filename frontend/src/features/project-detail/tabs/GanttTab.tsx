import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GanttChartSquare, RefreshCw, Sparkles, Square, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Spinner } from "@/components/shared/Spinner";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, shortSha } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { AnalyzeAll, GanttCommit, GanttOut, JobStatus } from "@/types/api";

import { GanttChart } from "./gantt/GanttChart";

/** Narrow a Gantt payload to the [start, end] window of the selected sprints. */
function filterToWindow(data: GanttOut, start: string, end: string): GanttOut {
  const overlaps = (s: string, e: string) => e >= start && s <= end;
  return {
    ...data,
    rows: data.rows
      .map((r) => ({ ...r, items: r.items.filter((it) => overlaps(it.start, it.end)) }))
      .filter((r) => r.items.length > 0),
    sprints: data.sprints.filter((sp) => overlaps(sp.start, sp.end)),
    range_start: start,
    range_end: end,
  };
}

/** Badge for a commit's attribution state (in the unassigned list). */
function linkBadge(status: JobStatus) {
  switch (status) {
    case "running":
      return <StatusBadge variant="running" label="Analyzing" spinning />;
    case "queued":
      return <StatusBadge variant="accent" label="Queued" />;
    case "failed":
      return <StatusBadge variant="failed" label="Failed" />;
    case "ready":
      return <StatusBadge variant="neutral" label="No match" />;
    default:
      return <StatusBadge variant="neutral" label="Not analyzed" />;
  }
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-3 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

/** Commits not yet attributed to a Jira task, with per-commit + bulk analysis. */
function UnassignedCommits({
  projectId,
  commits,
}: {
  projectId: number;
  commits: GanttCommit[];
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.gantt(projectId) });

  const linkOne = useMutation({
    mutationFn: (commitId: number) => api.post<unknown>(`/commits/${commitId}/link`),
    onSuccess: invalidate,
    onError: (err: ApiError) => toast.error(err.detail || "Could not start analysis"),
  });

  const cancelOne = useMutation({
    mutationFn: (commitId: number) => api.post<unknown>(`/commits/${commitId}/link/cancel`),
    onSuccess: invalidate,
    onError: (err: ApiError) => toast.error(err.detail || "Could not stop analysis"),
  });

  const linkAll = useMutation({
    mutationFn: () => api.post<AnalyzeAll>(`/projects/${projectId}/link-commits`),
    onSuccess: (res) => {
      toast.success(res.queued ? `Queued ${res.queued} commit(s)` : "Nothing left to analyze");
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start analysis"),
  });

  const cancelAll = useMutation({
    mutationFn: () => api.post<AnalyzeAll>(`/projects/${projectId}/link-commits/cancel`),
    onSuccess: (res) => {
      toast.success(res.queued ? `Stopped ${res.queued} commit(s)` : "Nothing in progress");
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not stop analysis"),
  });

  const pendingOn = (id: number) =>
    (linkOne.isPending && linkOne.variables === id) ||
    (cancelOne.isPending && cancelOne.variables === id);
  const active = commits.some((c) => c.link_status === "running" || c.link_status === "queued");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">
          Commits without a Jira task
          <span className="ml-2 text-xs font-normal text-muted-foreground">{commits.length}</span>
        </CardTitle>
        <div className="flex items-center gap-2">
          {active ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancelAll.mutate()}
              disabled={cancelAll.isPending}
            >
              <Square className="size-4" />
              Stop all
            </Button>
          ) : null}
          <Button size="sm" onClick={() => linkAll.mutate()} disabled={linkAll.isPending}>
            <Sparkles className="size-4" />
            Analyze all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Attribution analyzes each commit and matches it against the Jira tasks in the sprint that
          covers its date. Matched commits move onto the task's bar above.
        </p>
        <ul className="divide-y">
          {commits.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {c.summary || <span className="text-muted-foreground">Not analyzed yet</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-mono">{shortSha(c.sha)}</span>
                  {c.repo_name ? <span>· {c.repo_name}</span> : null}
                  {c.author_name ? <span>· {c.author_name}</span> : null}
                  <span>· {formatDateTime(c.authored_at)}</span>
                </div>
              </div>
              {linkBadge(c.link_status)}
              {c.link_status === "running" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingOn(c.id)}
                  onClick={() => cancelOne.mutate(c.id)}
                >
                  <Square className="size-4" />
                  Stop Analyze
                </Button>
              ) : c.link_status === "queued" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingOn(c.id)}
                  onClick={() => cancelOne.mutate(c.id)}
                >
                  <X className="size-4" />
                  Remove From Queue
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingOn(c.id)}
                  onClick={() => linkOne.mutate(c.id)}
                >
                  {pendingOn(c.id) ? <Spinner /> : <Sparkles className="size-4" />}
                  Analyze
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function GanttTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const resetAll = useMutation({
    mutationFn: () => api.post<AnalyzeAll>(`/projects/${projectId}/link-commits/reset`),
    onSuccess: (res) => {
      toast.success(
        res.queued ? `Re-analyzing ${res.queued} matched commit(s)` : "No matched commits to reset",
      );
      qc.invalidateQueries({ queryKey: qk.gantt(projectId) });
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not re-analyze"),
  });

  const { data, isPending, error } = useQuery({
    queryKey: qk.gantt(projectId),
    queryFn: () => api.get<GanttOut>(`/projects/${projectId}/gantt`),
    refetchInterval: (q) =>
      q.state.data?.unassigned.some(
        (c) => c.link_status === "running" || c.link_status === "queued",
      )
        ? 2000
        : false,
  });

  if (isPending) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Building timeline…
      </div>
    );
  }

  if (error) {
    return (
      <ErrorAlert
        message={error instanceof ApiError ? error.detail : "Could not load the Gantt timeline."}
      />
    );
  }

  const matchedCount = data.rows.reduce(
    (n, r) => n + r.items.reduce((m, it) => m + (it.kind === "jira" ? it.commits.length : 0), 0),
    0,
  );

  // From/To sprint filter (client-side): narrow the chart to the selected window.
  const sprintsAsc = [...data.sprints].sort((a, b) => a.start.localeCompare(b.start));
  const firstId = sprintsAsc[0]?.id ?? null;
  const lastId = sprintsAsc[sprintsAsc.length - 1]?.id ?? null;
  const effFrom = sprintsAsc.find((s) => s.id === fromId) ?? sprintsAsc[0];
  const effTo = sprintsAsc.find((s) => s.id === toId) ?? sprintsAsc[sprintsAsc.length - 1];
  const isFiltered =
    sprintsAsc.length > 0 && (effFrom?.id !== firstId || effTo?.id !== lastId);

  let view = data;
  if (effFrom && effTo) {
    const winStart = effFrom.start <= effTo.start ? effFrom.start : effTo.start;
    const winEnd = effFrom.end >= effTo.end ? effFrom.end : effTo.end;
    view = filterToWindow(data, winStart, winEnd);
  }

  const hasChart = view.rows.length > 0 && view.range_start && view.range_end;

  if (data.rows.length === 0 && data.unassigned.length === 0) {
    return (
      <EmptyState
        icon={GanttChartSquare}
        title="Nothing to chart yet"
        hint="Sync Jira tasks and repo commits (and map members on the Members tab) to see a timeline."
      />
    );
  }

  return (
    <div className="space-y-4">
      {sprintsAsc.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Sprints</span>
          <Select value={String(effFrom?.id)} onValueChange={(v) => setFromId(Number(v))}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder="From…" />
            </SelectTrigger>
            <SelectContent>
              {sprintsAsc.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">to</span>
          <Select value={String(effTo?.id)} onValueChange={(v) => setToId(Number(v))}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder="To…" />
            </SelectTrigger>
            <SelectContent>
              {sprintsAsc.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isFiltered ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFromId(null);
                setToId(null);
              }}
            >
              <X className="size-4" />
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {hasChart ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <LegendDot className="bg-muted-foreground/30" label="To do" />
              <LegendDot className="bg-warning/80" label="In progress" />
              <LegendDot className="bg-success/80" label="Done" />
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-1.5 rounded-full bg-primary" /> Attributed commit
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-4 rounded-sm border border-dashed border-primary/50 bg-primary/10" />
                Sprint
              </span>
            </div>
            {matchedCount > 0 ? (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="outline" disabled={resetAll.isPending}>
                    <RefreshCw className="size-4" />
                    Re-analyze matched ({matchedCount})
                  </Button>
                }
                title="Re-analyze matched commits?"
                description="Clears the current task link for every matched commit and re-runs attribution with the member-aware rule. This re-runs the analysis provider and may take a while."
                confirmLabel="Re-analyze"
                destructive={false}
                onConfirm={() => resetAll.mutate()}
              />
            ) : null}
          </div>
          <GanttChart data={view} />
        </>
      ) : data.rows.length > 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No tasks or commits in the selected sprint range.
        </p>
      ) : null}

      {data.unassigned.length ? (
        <UnassignedCommits projectId={projectId} commits={data.unassigned} />
      ) : null}
    </div>
  );
}
