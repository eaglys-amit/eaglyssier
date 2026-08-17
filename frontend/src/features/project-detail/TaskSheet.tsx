import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Link2, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { KpiStat } from "@/components/shared/KpiStat";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, shortSha, taskLabel } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Milestone, Task, TaskDetail, TaskNode } from "@/types/api";

/** Slide-over task detail bound to the ?task= search param (works from any tab). */
export function TaskSheet() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const taskId = Number(params.get("task"));
  const open = Number.isFinite(taskId) && taskId > 0;

  const { data: task, isPending, error } = useQuery({
    queryKey: qk.task(taskId),
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: open,
  });

  const reanalyze = useMutation({
    mutationFn: (commitId: number) => api.post<unknown>(`/commits/${commitId}/link/reset`),
    onSuccess: () => {
      toast.success("Re-analyzing commit");
      qc.invalidateQueries({ queryKey: qk.task(taskId) });
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "projects" && q.queryKey[2] === "gantt",
      });
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not re-analyze"),
  });

  // Open the commit sheet (candidate picker) to manually override the match.
  const reattach = (commitId: number) => {
    params.delete("task");
    params.set("commit", String(commitId));
    setParams(params, { replace: false });
  };

  const close = () => {
    params.delete("task");
    setParams(params, { replace: true });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {isPending ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <div className="p-4">
            <ErrorAlert message="Could not load this task." />
          </div>
        ) : task ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">{task.key}</span>
                {taskCategoryBadge(task.status_category, task.status)}
              </SheetTitle>
              <SheetDescription className="text-left text-base font-medium text-foreground">
                {task.title}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <div className="grid grid-cols-2 gap-2">
                <KpiStat label="Story points" value={task.story_points ?? "—"} />
                <KpiStat label="Hours logged" value={task.hours} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {task.issue_type ? <Badge variant="outline">{task.issue_type}</Badge> : null}
                {task.sprint ? <Badge variant="secondary">{task.sprint}</Badge> : null}
                {task.assignee ? <Badge variant="secondary">{task.assignee}</Badge> : null}
                {task.source === "local" ? <Badge variant="outline">Local</Badge> : null}
              </div>

              <MilestonePicker task={task} />
              <EpicPicker task={task} />

              {/* Kept alongside the picker, not replaced by it: setting the epic
                  and walking up to it are different intentions. */}
              {task.parent_key ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() =>
                    task.parent_id != null &&
                    setParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set("task", String(task.parent_id));
                      return next;
                    })
                  }
                >
                  <GitBranch className="size-3.5" />
                  Open <span className="font-mono">{task.parent_key}</span>
                </button>
              ) : null}
              {task.description ? (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Description
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{task.description}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}

              {task.commits.length ? (
                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Commits ({task.commits.length})
                  </div>
                  <ul className="space-y-2">
                    {task.commits.map((c) => (
                      <li key={c.id} className="flex items-start gap-2 rounded-md border px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            {c.summary || (
                              <span className="text-muted-foreground">No summary.</span>
                            )}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span className="font-mono">{shortSha(c.sha)}</span>
                            {c.author_name ? <span>· {c.author_name}</span> : null}
                            <span>· {formatDateTime(c.authored_at)}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Re-attach: pick a different task"
                            onClick={() => reattach(c.id)}
                          >
                            <Link2 className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Re-analyze this commit's task attribution"
                            disabled={reanalyze.isPending && reanalyze.variables === c.id}
                            onClick={() => reanalyze.mutate(c.id)}
                          >
                            <RefreshCw className="size-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Sentinel: Radix Select forbids an empty-string item value. */
const NO_MILESTONE = "none";
const NO_EPIC = "none";

/**
 * Assign the task to a milestone from wherever it was opened — the board, the
 * Gantt, a report. The Milestones tab is the other end of the same link; this
 * is the end you reach while actually looking at the work.
 */
function MilestonePicker({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const projectId = task.project_id;

  const { data: milestones } = useQuery({
    queryKey: qk.milestones(projectId),
    queryFn: () => api.get<Milestone[]>(`/projects/${projectId}/milestones`),
    enabled: Number.isFinite(projectId),
  });

  const assign = useMutation({
    mutationFn: (milestoneId: number | null) =>
      api.patch<Task>(`/tasks/${task.id}`, { milestone_id: milestoneId }),
    onSuccess: (_task, milestoneId) => {
      qc.invalidateQueries({ queryKey: qk.task(task.id) });
      // Prefix key — sweeps the list, the roadmap and the per-milestone tasks.
      qc.invalidateQueries({ queryKey: qk.milestones(projectId) });
      qc.invalidateQueries({ queryKey: qk.board(projectId) });
      toast.success(milestoneId === null ? "Removed from its milestone" : "Milestone updated");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not set the milestone"),
  });

  // Nothing to pick from yet, and no good place here to explain milestones.
  if (!milestones?.length) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">Milestone</span>
      <Select
        value={task.milestone_id === null ? NO_MILESTONE : String(task.milestone_id)}
        disabled={assign.isPending}
        onValueChange={(v) => assign.mutate(v === NO_MILESTONE ? null : Number(v))}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_MILESTONE}>None</SelectItem>
          {milestones.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Attach this task to an epic, or detach it.
 *
 * Mirrors MilestonePicker above: same shape, same invalidation discipline. The
 * candidate list is the tree's roots minus this task — everything below a task
 * has a parent, so no descendant can appear as a root and offer itself as a
 * cycle. The server still guards the rest (backlog._check_parent).
 */
function EpicPicker({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const projectId = task.project_id;

  const { data: tree } = useQuery({
    queryKey: qk.taskTree(projectId),
    queryFn: () => api.get<TaskNode[]>(`/projects/${projectId}/task-tree`),
    enabled: Number.isFinite(projectId),
  });

  const assign = useMutation({
    mutationFn: (parentId: number | null) =>
      api.patch<Task>(`/tasks/${task.id}`, { parent_id: parentId }),
    onSuccess: (_task, parentId) => {
      qc.invalidateQueries({ queryKey: qk.task(task.id) });
      qc.invalidateQueries({ queryKey: qk.taskTree(projectId) });
      // Re-parenting changes what counts as a container, which the board's
      // Leaves filter and every points rollup read.
      qc.invalidateQueries({ queryKey: qk.board(projectId) });
      qc.invalidateQueries({ queryKey: qk.milestones(projectId) });
      toast.success(parentId === null ? "Removed from its epic" : "Epic updated");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not set the epic"),
  });

  const options = (tree ?? []).filter((n) => n.id !== task.id);
  if (!options.length) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">Epic</span>
      <Select
        value={task.parent_id === null ? NO_EPIC : String(task.parent_id)}
        disabled={assign.isPending}
        onValueChange={(v) => assign.mutate(v === NO_EPIC ? null : Number(v))}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_EPIC}>None</SelectItem>
          {options.map((n) => (
            <SelectItem key={n.id} value={String(n.id)}>
              {taskLabel(n)} · {n.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
