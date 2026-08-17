import { useQuery } from "@tanstack/react-query";
import { GitBranch, Link2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { KpiStat } from "@/components/shared/KpiStat";
import { milestoneHealthBadge, taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatDate, formatPoints, taskLabel } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { BacklogBoard, Milestone, MilestoneEpicGroup } from "@/types/api";

import { MilestoneProgress } from "./MilestoneProgress";
import { useMilestones, useMilestoneTasks } from "./useMilestones";

/**
 * Milestone detail, bound to `?milestone=`. Shows the work behind the number.
 *
 * The picker is fed from the board query the Scrums tab already caches, so
 * opening this sheet costs no extra fetch and the two views can't disagree
 * about which sprint a task is in.
 */
export function MilestoneSheet({
  projectId,
  milestones,
}: {
  projectId: number;
  milestones: Milestone[];
}) {
  const [params, setParams] = useSearchParams();
  const milestoneId = Number(params.get("milestone")) || null;
  const open = milestoneId !== null;
  const milestone = milestones.find((m) => m.id === milestoneId) ?? null;

  const { linkTasks, unlinkTask } = useMilestones(projectId);
  const tasks = useMilestoneTasks(projectId, milestoneId);

  const close = () => {
    params.delete("milestone");
    setParams(params, { replace: true });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {!milestone ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {milestone.name}
                {milestoneHealthBadge(milestone.health)}
              </SheetTitle>
              <SheetDescription>
                {formatDate(milestone.start_date)} → {formatDate(milestone.target_date)}
                {milestone.forecast_date
                  ? ` · forecast ${formatDate(milestone.forecast_date)}`
                  : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              {milestone.description ? (
                <p className="text-sm text-muted-foreground">{milestone.description}</p>
              ) : null}

              <MilestoneProgress progress={milestone.progress} health={milestone.health} />

              <div className="grid grid-cols-3 gap-2">
                <KpiStat
                  label="Points"
                  value={`${formatPoints(milestone.completed_points)}/${formatPoints(milestone.total_points)}`}
                />
                <KpiStat
                  label="Tasks"
                  value={`${milestone.completed_tasks}/${milestone.total_tasks}`}
                />
                <KpiStat
                  label="Slip"
                  value={
                    milestone.days_late === null
                      ? "—"
                      : milestone.days_late > 0
                        ? `+${milestone.days_late}d`
                        : `${milestone.days_late}d`
                  }
                />
              </div>

              {milestone.unestimated_tasks > 0 ? (
                <p className="text-xs text-warning">
                  {milestone.unestimated_tasks} linked{" "}
                  {milestone.unestimated_tasks === 1 ? "task has" : "tasks have"} no estimate,
                  so {milestone.unestimated_tasks === 1 ? "it doesn't" : "they don't"} count
                  toward progress or the forecast.
                </p>
              ) : null}

              <LinkedTasks
                projectId={projectId}
                milestoneId={milestone.id}
                loading={tasks.isPending}
                onUnlink={(taskId) => unlinkTask.mutate({ milestoneId: milestone.id, taskId })}
              />

              <TaskPicker
                projectId={projectId}
                linkedIds={new Set((tasks.data ?? []).map((t) => t.id))}
                pending={linkTasks.isPending}
                onLink={(taskIds) => linkTasks.mutate({ milestoneId: milestone.id, taskIds })}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Linked work, grouped by the epic it belongs to.
 *
 * Epic rather than sprint, because that's the relationship a milestone is made
 * of: it covers epics, and one epic's tasks routinely run across several
 * sprints. So the sprint is a badge on each row instead of the heading — the
 * milestone header already summarises which sprints it spans.
 *
 * The grouping is the server's (`/milestones/:id/epics`), derived from the task
 * tree on read, so it can't drift from the board or from the Epics tab.
 */
function LinkedTasks({
  projectId,
  milestoneId,
  loading,
  onUnlink,
}: {
  projectId: number;
  milestoneId: number;
  loading: boolean;
  onUnlink: (taskId: number) => void;
}) {
  const [params, setParams] = useSearchParams();
  const { data: board } = useQuery({
    queryKey: qk.board(projectId),
    queryFn: () => api.get<BacklogBoard>(`/projects/${projectId}/backlog-board`),
  });

  const { data: groups } = useQuery({
    queryKey: qk.milestoneEpics(projectId, milestoneId),
    queryFn: () =>
      api.get<MilestoneEpicGroup[]>(
        `/projects/${projectId}/milestones/${milestoneId}/epics`,
      ),
    enabled: Number.isFinite(milestoneId),
  });

  const sprintName = (id: number | null) =>
    id === null
      ? "Backlog"
      : board?.sprints.find((s) => s.sprint_id === id)?.name ?? `Sprint ${id}`;

  const openTask = (taskId: number) => {
    params.set("task", String(taskId));
    setParams(params, { replace: false });
  };

  if (loading) return <Skeleton className="h-24 w-full" />;

  const rows = (groups ?? []).reduce((n, g) => n + g.tasks.length, 0);
  if (!rows) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
        Nothing linked yet. Until there is, this milestone has no progress and no forecast.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Linked work ({rows})
      </h4>
      {(groups ?? []).map((group) => (
        <div key={group.epic_task_id ?? "standalone"} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {group.epic_task_id != null ? (
              <button
                type="button"
                onClick={() => openTask(group.epic_task_id!)}
                className="flex min-w-0 items-center gap-1.5 text-left hover:underline"
              >
                <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {group.epic_key}
                </span>
                <span className="truncate text-xs font-medium">{group.epic_title}</span>
              </button>
            ) : (
              // Named, not left blank: "no epic" is a fact about this work, and
              // a heading-less group reads as a rendering bug.
              <span className="text-xs font-medium text-muted-foreground">
                Not under an epic
              </span>
            )}
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatPoints(group.total_points)} pts
            </span>
            {group.uncounted_points > 0 ? (
              <span
                className="font-mono text-[10px] tabular-nums text-warning"
                title="Points sitting on a task that has subtasks. They aren't counted — the subtasks carry the total — so move them down or clear them."
              >
                +{formatPoints(group.uncounted_points)} uncounted
              </span>
            ) : null}
          </div>
          <ul className="divide-y rounded-lg border">
            {group.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => openTask(task.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                >
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {taskLabel(task)}
                  </span>
                  <span className="truncate text-xs">{task.title}</span>
                </button>
                {/* Where the work sits — the thing the epic grouping gives up. */}
                <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                  {sprintName(task.sprint_id)}
                </Badge>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {task.story_points === null ? "—" : formatPoints(task.story_points)}
                </span>
                {taskCategoryBadge(task.status_category)}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onUnlink(task.id)}
                  title="Unlink from this milestone"
                >
                  <X className="size-3.5" />
                  <span className="sr-only">Unlink {taskLabel(task)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Add work: every task in the project that isn't already on this milestone. */
function TaskPicker({
  projectId,
  linkedIds,
  pending,
  onLink,
}: {
  projectId: number;
  linkedIds: Set<number>;
  pending: boolean;
  onLink: (taskIds: number[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const { data: board } = useQuery({
    queryKey: qk.board(projectId),
    queryFn: () => api.get<BacklogBoard>(`/projects/${projectId}/backlog-board`),
    enabled: expanded,
  });

  const candidates = useMemo(() => {
    if (!board) return [];
    const all = [
      ...board.backlog.map((t) => ({ task: t, where: "Backlog" })),
      ...board.sprints.flatMap((s) => s.tasks.map((t) => ({ task: t, where: s.name }))),
    ].filter(({ task }) => !linkedIds.has(task.id));
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      ({ task }) =>
        task.title.toLowerCase().includes(q) ||
        taskLabel(task).toLowerCase().includes(q),
    );
  }, [board, linkedIds, filter]);

  const toggle = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    if (!picked.size) return;
    onLink([...picked]);
    setPicked(new Set());
    setExpanded(false);
    setFilter("");
  };

  if (!expanded) {
    return (
      <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
        <Plus className="size-4" />
        Link tasks
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-2.5">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={filter}
          placeholder="Filter by key or title…"
          onChange={(e) => setFilter(e.target.value)}
          className="h-8"
        />
        <Button size="sm" disabled={!picked.size || pending} onClick={submit}>
          <Link2 className="size-4" />
          {pending ? "Linking…" : `Link ${picked.size || ""}`}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
          Cancel
        </Button>
      </div>

      {!board ? (
        <Skeleton className="h-32 w-full" />
      ) : !candidates.length ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {filter ? "Nothing matches that." : "Every task in the project is already linked."}
        </p>
      ) : (
        <ul className="max-h-64 divide-y overflow-y-auto rounded border">
          {candidates.map(({ task, where }) => (
            <li key={task.id}>
              <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50">
                <Checkbox
                  checked={picked.has(task.id)}
                  onCheckedChange={() => toggle(task.id)}
                />
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {taskLabel(task)}
                </span>
                <span className="truncate text-xs">{task.title}</span>
                <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                  {where}
                </Badge>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {task.story_points === null ? "—" : formatPoints(task.story_points)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
