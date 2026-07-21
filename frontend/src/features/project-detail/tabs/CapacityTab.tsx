import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { StoryPointScaleSection } from "@/features/project-detail/tabs/capacity/StoryPointScaleSection";
import type { SprintCapacity, SprintCapacityIn } from "@/types/api";

/** Round to 1 decimal, dropping a trailing .0 for display. */
function fmt(n: number): string {
  return Number(n.toFixed(1)).toString();
}

function SprintCapacityCard({
  sprint,
  onSave,
  saving,
}: {
  sprint: SprintCapacity;
  onSave: (body: SprintCapacityIn) => void;
  saving: boolean;
}) {
  // Local edit state (strings so partial typing works); reseeded when server data changes.
  const [workingDays, setWorkingDays] = useState(String(sprint.working_days));
  const [focus, setFocus] = useState<Record<number, string>>(() =>
    Object.fromEntries(sprint.members.map((m) => [m.member_id, String(m.focus_factor)])),
  );
  useEffect(() => {
    setWorkingDays(String(sprint.working_days));
    setFocus(Object.fromEntries(sprint.members.map((m) => [m.member_id, String(m.focus_factor)])));
  }, [sprint]);

  const wd = Number(workingDays) || 0;

  const commit = (nextFocus: Record<number, string>, nextDays: number) => {
    onSave({
      working_days: nextDays,
      members: sprint.members.map((m) => ({
        member_id: m.member_id,
        focus_factor: Math.max(0, Math.min(1, Number(nextFocus[m.member_id]) || 0)),
      })),
    });
  };

  return (
    <Collapsible className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
          <span className="truncate text-sm font-medium">{sprint.name}</span>
          {sprint.state ? (
            <StatusBadge
              variant={sprint.state === "active" ? "running" : "neutral"}
              label={sprint.state}
            />
          ) : null}
          <span className="hidden text-xs text-muted-foreground lg:inline">
            {formatDate(sprint.start_date)} → {formatDate(sprint.end_date)}
          </span>
        </CollapsibleTrigger>
        <Badge variant="secondary" className="font-mono tabular-nums">
          Team {fmt(sprint.team_completed)}/{fmt(sprint.team_capacity)} pts
        </Badge>
      </div>
      <CollapsibleContent>
        <div className="border-t">
          <div className="flex items-center gap-1.5 px-3 py-2">
            <Label htmlFor={`wd-${sprint.sprint_id}`} className="text-xs text-muted-foreground">
              Working days
            </Label>
            <Input
              id={`wd-${sprint.sprint_id}`}
              type="number"
              min={0}
              value={workingDays}
              onChange={(e) => setWorkingDays(e.target.value)}
              onBlur={() => commit(focus, Number(workingDays) || 0)}
              className="h-8 w-20 font-mono tabular-nums"
            />
            {saving ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="w-32">Focus (0–1)</TableHead>
                <TableHead className="w-20 text-right">Alloc.</TableHead>
                <TableHead className="w-20 text-right">Done</TableHead>
                <TableHead className="w-20 text-right">Δ</TableHead>
                <TableHead className="w-28 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sprint.members.map((m) => {
                const ff = Math.max(0, Math.min(1, Number(focus[m.member_id]) || 0));
                const allocated = Number((ff * wd).toFixed(1));
                const delta = Number((m.completed_points - allocated).toFixed(1));
                const over = m.completed_points > allocated;
                return (
                  <TableRow key={m.member_id}>
                    <TableCell className="max-w-[10rem] truncate">{m.display_name}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        min={0}
                        max={1}
                        value={focus[m.member_id] ?? ""}
                        onChange={(e) =>
                          setFocus((f) => ({ ...f, [m.member_id]: e.target.value }))
                        }
                        onBlur={() => commit(focus, Number(workingDays) || 0)}
                        className="h-8 w-20 font-mono tabular-nums"
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmt(allocated)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmt(m.completed_points)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {delta > 0 ? `+${fmt(delta)}` : fmt(delta)}
                    </TableCell>
                    <TableCell className="text-right">
                      {allocated <= 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <StatusBadge
                          variant={over ? "success" : "warning"}
                          label={over ? "At/over" : "Under"}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CapacityTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const key = qk.capacity(projectId);
  const { data: capacity, isPending } = useQuery({
    queryKey: key,
    queryFn: () => api.get<SprintCapacity[]>(`/projects/${projectId}/capacity`),
  });

  const save = useMutation({
    mutationFn: ({ sprintId, body }: { sprintId: number; body: SprintCapacityIn }) =>
      api.put<SprintCapacity>(`/projects/${projectId}/sprints/${sprintId}/capacity`, body),
    onSuccess: (updated) => {
      qc.setQueryData<SprintCapacity[]>(key, (prev) =>
        (prev ?? []).map((s) => (s.sprint_id === updated.sprint_id ? updated : s)),
      );
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save capacity"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Left: sprint capacity cards in a scroll area */}
      <div className="min-w-0">
        <div className="mb-2">
          <h2 className="text-sm font-semibold tracking-tight">Sprint capacity</h2>
          <p className="text-xs text-muted-foreground">
            Allocated = focus factor × working days. Done = story points of that member's done
            tasks in the sprint.
          </p>
        </div>

        {isPending ? (
          <TableSkeleton rows={4} />
        ) : !capacity?.length ? (
          <EmptyState
            icon={CalendarRange}
            title="No sprints"
            hint="Sync Jira to pull sprints, then set focus factors here."
          />
        ) : (
          <div className="max-h-[calc(100vh-14rem)] space-y-2 overflow-y-auto pr-1">
            {capacity.map((s) => (
              <SprintCapacityCard
                key={s.sprint_id}
                sprint={s}
                saving={save.isPending && save.variables?.sprintId === s.sprint_id}
                onSave={(body) => save.mutate({ sprintId: s.sprint_id, body })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: story-point scale (always expanded) */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <StoryPointScaleSection projectId={projectId} />
      </div>
    </div>
  );
}
