import { ArrowDown, ArrowUp, ListChecks, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { milestoneHealthBadge } from "@/components/shared/StatusBadge";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Milestone } from "@/types/api";

import { GenerateButton } from "./GenerateDialog";
import { GenerateEpicsButton } from "./GenerateEpicsDialog";
import { NameEpicsButton } from "./NameEpicsDialog";
import { MilestoneDialog } from "./MilestoneDialog";
import { MilestoneProgress } from "./MilestoneProgress";
import { useMilestones } from "./useMilestones";

type SortKey = "name" | "target" | "progress" | "points" | "forecast";

/** Sortable header cell. Client-side only — there is no DataTable here by design. */
function SortHead({
  label,
  sortKey,
  active,
  desc,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  desc: boolean;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = active === sortKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          isActive && "text-foreground",
        )}
      >
        {label}
        {isActive ? (
          desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
        ) : null}
      </button>
    </TableHead>
  );
}

/** Undated milestones sort last in either direction, rather than clumping at one end. */
function compare(a: Milestone, b: Milestone, key: SortKey): number {
  const nullsLast = (x: string | null, y: string | null) => {
    if (x === y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -1 : 1;
  };
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "target":
      return nullsLast(a.target_date, b.target_date);
    case "forecast":
      return nullsLast(a.forecast_date, b.forecast_date);
    case "progress":
      return a.progress - b.progress;
    case "points":
      return a.total_points - b.total_points;
  }
}

export function MilestoneListView({
  projectId,
  onOpenMilestone,
}: {
  projectId: number;
  onOpenMilestone: (id: number) => void;
}) {
  const navigate = useNavigate();
  const { milestones, isPending, error, createMilestone, patchMilestone, deleteMilestone } =
    useMilestones(projectId);

  const [sort, setSort] = useState<SortKey>("target");
  const [desc, setDesc] = useState(false);

  const rows = useMemo(() => {
    const sorted = [...milestones].sort((a, b) => compare(a, b, sort));
    return desc ? sorted.reverse() : sorted;
  }, [milestones, sort, desc]);

  const onSort = (key: SortKey) => {
    if (key === sort) setDesc((v) => !v);
    else {
      setSort(key);
      setDesc(false);
    }
  };

  const newButton = (
    <MilestoneDialog
      trigger={
        <Button size="sm">
          <Plus className="size-4" />
          New milestone
        </Button>
      }
      pending={createMilestone.isPending}
      onSubmit={(values) => createMilestone.mutateAsync(values)}
    />
  );

  if (error) return <ErrorAlert message={error.message || "Could not load milestones"} />;
  if (isPending) return <TableSkeleton rows={6} />;

  if (!milestones.length) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No milestones yet"
        hint="A milestone is a dated goal above the sprint horizon. Link the tasks that have to be done for it and the progress, spanned sprints and completion forecast all follow from the board."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <GenerateButton projectId={projectId} variant="default" />
            {newButton}
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {milestones.length} {milestones.length === 1 ? "milestone" : "milestones"} · every
          number rolled up from linked tasks
        </p>
        <div className="flex shrink-0 gap-2">
          <GenerateEpicsButton projectId={projectId} />
          <NameEpicsButton projectId={projectId} />
          <GenerateButton projectId={projectId} />
          {newButton}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Milestone" sortKey="name" active={sort} desc={desc} onSort={onSort} />
                <SortHead label="Target" sortKey="target" active={sort} desc={desc} onSort={onSort} className="w-28" />
                <TableHead className="w-44">Sprints</TableHead>
                <SortHead label="Progress" sortKey="progress" active={sort} desc={desc} onSort={onSort} className="w-40" />
                <SortHead label="Points" sortKey="points" active={sort} desc={desc} onSort={onSort} className="w-28 text-right" />
                <TableHead className="w-24 text-right">Tasks</TableHead>
                <SortHead label="Forecast" sortKey="forecast" active={sort} desc={desc} onSort={onSort} className="w-36" />
                <TableHead className="w-32">Health</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow
                  key={m.id}
                  className="cursor-pointer"
                  onClick={() => onOpenMilestone(m.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.name}</span>
                      {m.state !== "planned" ? (
                        <Badge variant="secondary" className="capitalize">
                          {m.state.replace("_", " ")}
                        </Badge>
                      ) : null}
                    </div>
                    {m.description ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {m.description}
                      </p>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-xs">{formatDate(m.target_date)}</TableCell>

                  <TableCell>
                    {m.sprints.length ? (
                      <div className="flex flex-wrap gap-1">
                        {m.sprints.map((s) => (
                          <Badge
                            key={s.sprint_id}
                            variant="secondary"
                            className="cursor-pointer text-[10px] hover:bg-accent"
                            title={`${formatPoints(s.points_in_milestone)} pts here · open in Scrums`}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(
                                `/projects/${projectId}/scrums?view=charts&sprint=${s.sprint_id}`,
                              );
                            }}
                          >
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">backlog only</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <MilestoneProgress progress={m.progress} health={m.health} />
                  </TableCell>

                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatPoints(m.completed_points)} / {formatPoints(m.total_points)}
                  </TableCell>

                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {m.completed_tasks} / {m.total_tasks}
                    {m.unestimated_tasks > 0 ? (
                      <span
                        className="ml-1 text-warning"
                        title={`${m.unestimated_tasks} unestimated — they don't count toward progress or the forecast`}
                      >
                        ⚠
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-xs">
                    {m.forecast_date ? (
                      <span className="flex flex-col">
                        <span>{formatDate(m.forecast_date)}</span>
                        {m.days_late !== null && m.days_late !== 0 ? (
                          <span
                            className={cn(
                              "font-mono text-[10px] tabular-nums",
                              m.days_late > 0 ? "text-warning" : "text-success",
                            )}
                          >
                            {m.days_late > 0 ? `+${m.days_late}d` : `${m.days_late}d`}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell>{milestoneHealthBadge(m.health)}</TableCell>

                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                          <span className="sr-only">Actions for {m.name}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <MilestoneDialog
                          milestone={m}
                          pending={patchMilestone.isPending}
                          onSubmit={(values) =>
                            patchMilestone.mutateAsync({ milestoneId: m.id, body: values })
                          }
                          trigger={
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                          }
                        />
                        <ConfirmDialog
                          title={`Delete ${m.name}?`}
                          description="The milestone goes; its tasks stay exactly where they are, just unlinked."
                          onConfirm={() => deleteMilestone.mutate(m.id)}
                          trigger={
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={(e) => e.preventDefault()}
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          }
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
