import { useQuery } from "@tanstack/react-query";
import { Map as MapIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ChartFrame, LegendKey } from "@/components/shared/ChartFrame";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiStat } from "@/components/shared/KpiStat";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDate, formatPoints } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Roadmap } from "@/types/api";

import { GenerateButton } from "./GenerateDialog";
import { RoadmapChart } from "./RoadmapChart";

/**
 * The roadmap: milestone bars against the project's real sprint cadence.
 *
 * Every number here is derived server-side from the tasks linked to each
 * milestone, and the forecast comes from the same build_velocity() behind the
 * Scrums velocity chart — so this view and that one can't tell different
 * stories about the same team.
 */
export function RoadmapView({
  projectId,
  onOpenMilestone,
}: {
  projectId: number;
  onOpenMilestone: (id: number) => void;
}) {
  const navigate = useNavigate();

  const roadmap = useQuery({
    queryKey: qk.roadmap(projectId),
    queryFn: () => api.get<Roadmap>(`/projects/${projectId}/roadmap`),
  });

  if (roadmap.isPending && !roadmap.data) return <TableSkeleton rows={6} />;
  const data = roadmap.data;
  if (!data) return null;

  if (!data.milestones.length) {
    return (
      <EmptyState
        icon={MapIcon}
        title="No milestones yet"
        hint="Generate a set from the epics already in your backlog, or add them by hand from the List view. Either way, progress and the completion forecast come from the linked tasks — there's nothing else to keep up to date."
        action={<GenerateButton projectId={projectId} variant="default" />}
      />
    );
  }

  const atRisk = data.milestones.filter(
    (m) => m.health === "at_risk" || m.health === "overdue",
  ).length;
  const remaining = data.milestones.reduce((sum, m) => sum + m.remaining_points, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiStat label="Milestones" value={data.milestones.length} />
        <KpiStat label="At risk" value={atRisk} />
        <KpiStat label="Points remaining" value={formatPoints(remaining)} />
        <KpiStat
          label="Velocity (last 3)"
          value={data.velocity_rolling3 ? formatPoints(data.velocity_rolling3) : "—"}
        />
      </div>

      {/* Reachable from here too: new epics appear on the board long after the
          first generate, and this is the view where the gap is visible. */}
      <div className="flex justify-end">
        <GenerateButton projectId={projectId} />
      </div>

      <ChartFrame
        title="Roadmap"
        stale={roadmap.isFetching}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {formatDate(data.range_start)} → {formatDate(data.range_end)}
            </span>
            {data.velocity_rolling3 || data.velocity_average ? (
              <span>
                · forecast at{" "}
                {formatPoints(data.velocity_rolling3 || data.velocity_average)} pts per{" "}
                {data.sprint_length_days}-day sprint
              </span>
            ) : (
              <span className="text-warning">
                no closed sprint yet, so nothing can be forecast
              </span>
            )}
          </span>
        }
        legend={
          <span className="flex flex-wrap items-center gap-3">
            <LegendKey kind="bar" className="bg-primary/80" label="On track" />
            <LegendKey kind="bar" className="bg-warning/80" label="At risk" />
            <LegendKey kind="bar" className="bg-destructive/80" label="Overdue" />
            <LegendKey kind="dashed" className="stroke-warning" label="Forecast" />
          </span>
        }
        table={<RoadmapTable data={data} />}
      >
        <RoadmapChart
          data={data}
          onOpenMilestone={onOpenMilestone}
          // The sprint behind a band is one click away, on the tab that owns it.
          onOpenSprint={(sprintId) =>
            navigate(`/projects/${projectId}/scrums?view=charts&sprint=${sprintId}`)
          }
        />
      </ChartFrame>
    </div>
  );
}

/** The accessible twin: every plotted date and number, reachable without hovering. */
function RoadmapTable({ data }: { data: Roadmap }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Milestone</TableHead>
          <TableHead className="w-28">Start</TableHead>
          <TableHead className="w-28">Target</TableHead>
          <TableHead className="w-28">Forecast</TableHead>
          <TableHead className="w-20 text-right">Slip</TableHead>
          <TableHead className="w-20 text-right">Done</TableHead>
          <TableHead className="w-28 text-right">Points</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.milestones.map((m) => (
          <TableRow key={m.id}>
            <TableCell className="text-xs">{m.name}</TableCell>
            <TableCell className="text-xs">{formatDate(m.start_date)}</TableCell>
            <TableCell className="text-xs">{formatDate(m.target_date)}</TableCell>
            <TableCell className="text-xs">{formatDate(m.forecast_date)}</TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums">
              {m.days_late === null ? "—" : m.days_late > 0 ? `+${m.days_late}d` : `${m.days_late}d`}
            </TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums">
              {Math.round(m.progress * 100)}%
            </TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums">
              {formatPoints(m.completed_points)} / {formatPoints(m.total_points)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
