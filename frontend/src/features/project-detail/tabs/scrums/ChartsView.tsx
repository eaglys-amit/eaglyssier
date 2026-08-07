import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { KpiStat } from "@/components/shared/KpiStat";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatPoints } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { BacklogBoard, Burndown, SnapshotOut, Velocity } from "@/types/api";

import { BurndownChart } from "./BurndownChart";
import { ChartFrame, LegendKey } from "./ChartFrame";
import { VelocityChart } from "./VelocityChart";

/**
 * Burndown for the selected sprint, velocity across all of them.
 *
 * The sprint picker lives in one row above both charts (the tab's shared
 * control), never inside a card — so everything below re-renders against the
 * same slice and the numbers always agree.
 */
export function ChartsView({
  projectId,
  sprintId,
  onSelectSprint,
}: {
  projectId: number;
  sprintId: number | null;
  onSelectSprint: (id: number) => void;
}) {
  const qc = useQueryClient();

  const { data: board } = useQuery({
    queryKey: qk.board(projectId),
    queryFn: () => api.get<BacklogBoard>(`/projects/${projectId}/backlog-board`),
  });
  const sprints = board?.sprints ?? [];
  const active = sprints.find((s) => s.sprint_id === sprintId) ?? sprints[0] ?? null;

  const burndown = useQuery({
    queryKey: qk.burndown(projectId, active?.sprint_id ?? 0),
    queryFn: () =>
      api.get<Burndown>(`/projects/${projectId}/sprints/${active!.sprint_id}/burndown`),
    enabled: active != null,
  });

  const velocity = useQuery({
    queryKey: qk.velocity(projectId),
    queryFn: () => api.get<Velocity>(`/projects/${projectId}/velocity`),
  });

  const backfill = useMutation({
    mutationFn: () =>
      api.post<SnapshotOut>(
        `/projects/${projectId}/sprints/${active!.sprint_id}/backfill-snapshots`,
      ),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: qk.burndown(projectId, active!.sprint_id) });
      toast.success(
        result.written
          ? `Reconstructed ${result.written} days — approximate, since scope changes can't be recovered.`
          : "Nothing to reconstruct: every day already has a reading.",
      );
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not reconstruct history"),
  });

  if (!sprints.length) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No sprints to chart yet"
        hint="Burndown needs a sprint with dates; velocity needs at least one that has started."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* One filter row, above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Burndown for</span>
        <Select
          value={active ? String(active.sprint_id) : undefined}
          onValueChange={(v) => onSelectSprint(Number(v))}
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder="Pick a sprint" />
          </SelectTrigger>
          <SelectContent>
            {sprints.map((s) => (
              <SelectItem key={s.sprint_id} value={String(s.sprint_id)}>
                {s.name}
                {s.state === "active" ? " · active" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Headline numbers. Proportional figures — tabular only in columns. */}
      {burndown.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiStat label="Committed" value={formatPoints(burndown.data.committed_points)} />
          <KpiStat label="Completed" value={formatPoints(burndown.data.completed_points)} />
          <KpiStat label="Remaining" value={formatPoints(burndown.data.remaining_points)} />
          <KpiStat
            label="Avg velocity"
            value={velocity.data ? formatPoints(velocity.data.average) : "—"}
          />
        </div>
      ) : null}

      {/* ---- burndown -------------------------------------------------- */}
      {burndown.isPending && !burndown.data ? (
        <TableSkeleton rows={4} />
      ) : burndown.data ? (
        <ChartFrame
          title={`${burndown.data.sprint_name} burndown`}
          stale={burndown.isFetching}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {formatDate(burndown.data.start_date)} → {formatDate(burndown.data.end_date)} ·{" "}
                {burndown.data.working_days} working days
              </span>
              {burndown.data.approximate ? (
                <span className="text-warning">
                  approximate — some days were reconstructed, so scope changes aren't visible
                </span>
              ) : null}
            </span>
          }
          legend={
            <span className="flex items-center gap-3">
              <LegendKey kind="line" className="stroke-primary" label="Remaining" />
              <LegendKey kind="dashed" className="stroke-muted-foreground" label="Ideal" />
            </span>
          }
          table={<BurndownTable data={burndown.data} />}
        >
          <BurndownChart data={burndown.data} />
          {!burndown.data.points.length ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <History className="size-3.5" />
              This sprint predates daily snapshots.
              <Button
                size="xs"
                variant="outline"
                disabled={backfill.isPending}
                onClick={() => backfill.mutate()}
              >
                {backfill.isPending ? "Reconstructing…" : "Reconstruct from resolved dates"}
              </Button>
            </div>
          ) : null}
        </ChartFrame>
      ) : null}

      {/* ---- velocity -------------------------------------------------- */}
      {velocity.isPending && !velocity.data ? (
        <TableSkeleton rows={4} />
      ) : velocity.data ? (
        <ChartFrame
          title="Velocity"
          stale={velocity.isFetching}
          subtitle={
            <span>
              {formatPoints(velocity.data.average)} points per closed sprint over{" "}
              {velocity.data.closed_count}
              {velocity.data.rolling3 > 0
                ? ` · ${formatPoints(velocity.data.rolling3)} over the last 3`
                : ""}
            </span>
          }
          legend={
            <span className="flex items-center gap-3">
              <LegendKey kind="bar" className="bg-primary" label="Completed" />
              <LegendKey kind="rule" className="stroke-muted-foreground" label="Committed" />
            </span>
          }
          table={<VelocityTable data={velocity.data} />}
        >
          <VelocityChart data={velocity.data} />
        </ChartFrame>
      ) : null}
    </div>
  );
}

/** The accessible twin: every plotted number, reachable without hovering. */
function BurndownTable({ data }: { data: Burndown }) {
  if (!data.points.length) {
    return <p className="py-4 text-sm text-muted-foreground">No daily readings yet.</p>;
  }
  return (
    <div className="max-h-72 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead className="text-right">Completed</TableHead>
            <TableHead className="text-right">Scope</TableHead>
            <TableHead className="w-28">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.points.map((point) => (
            <TableRow key={point.date}>
              <TableCell className="text-xs">{formatDate(point.date)}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {formatPoints(point.remaining_points)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {formatPoints(point.completed_points)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {formatPoints(point.total_points)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {point.backfilled ? "reconstructed" : "sampled"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function VelocityTable({ data }: { data: Velocity }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sprint</TableHead>
          <TableHead className="text-right">Committed</TableHead>
          <TableHead className="text-right">Completed</TableHead>
          <TableHead className="text-right">Δ</TableHead>
          <TableHead className="w-20">State</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.sprints.map((sprint) => {
          const delta = Math.round((sprint.completed_points - sprint.committed_points) * 10) / 10;
          return (
            <TableRow key={sprint.sprint_id}>
              <TableCell className="text-xs">{sprint.name}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {formatPoints(sprint.committed_points)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {formatPoints(sprint.completed_points)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {delta > 0 ? `+${formatPoints(delta)}` : formatPoints(delta)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{sprint.state}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
