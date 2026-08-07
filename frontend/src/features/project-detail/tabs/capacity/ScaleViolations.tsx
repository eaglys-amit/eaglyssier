import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatPoints } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { ScaleViolation, ScaleViolationKind } from "@/types/api";

const KIND_LABEL: Record<ScaleViolationKind, string> = {
  off_deck: "Off scale",
  needs_breakdown: "Break down",
  hours_below_min: "Over-estimated",
  hours_above_max: "Under-estimated",
};

/**
 * Where the scale earns its keep: tasks whose estimate contradicts it.
 *
 * Advisory only — nothing here blocks a write. The point is that a scale nobody
 * checks against is just a table, so this is the feedback loop that turns it
 * into something the team can actually calibrate on.
 */
export function ScaleViolations({ projectId }: { projectId: number }) {
  const [, setParams] = useSearchParams();
  const { data } = useQuery({
    queryKey: qk.scaleViolations(projectId),
    queryFn: () => api.get<ScaleViolation[]>(`/projects/${projectId}/story-points/violations`),
  });

  if (!data) return null;

  return (
    <div>
      <div className="mb-2">
        <h2 className="text-sm font-semibold tracking-tight">Estimates vs the scale</h2>
        <p className="text-xs text-muted-foreground">
          Tasks whose points aren't on the scale, are flagged to break down but have no
          subtasks, or finished outside their hour band. Advisory — nothing is blocked.
        </p>
      </div>

      {data.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" />
          Every estimate matches the scale.
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Task</TableHead>
                <TableHead className="w-16 text-right">Pts</TableHead>
                <TableHead className="w-32">Issue</TableHead>
                <TableHead>What the scale says</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((v) => (
                <TableRow
                  key={`${v.task_id}-${v.kind}`}
                  className="cursor-pointer"
                  onClick={() =>
                    setParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set("task", String(v.task_id));
                      return next;
                    })
                  }
                >
                  <TableCell className="font-mono text-xs">{v.task_key}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatPoints(v.points)}
                  </TableCell>
                  <TableCell>
                    {v.kind === "needs_breakdown" ? (
                      <StatusBadge variant="warning" label={KIND_LABEL[v.kind]} />
                    ) : (
                      <Badge variant="secondary">{KIND_LABEL[v.kind]}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="line-clamp-2">{v.message}</span>
                    {v.hours != null ? (
                      <span className="ml-1 font-mono tabular-nums">({v.hours}h logged)</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
