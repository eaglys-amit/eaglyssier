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
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, shortSha } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { TaskDetail } from "@/types/api";

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

              {/* Where this sits in a breakdown. Without it, a task created from
                  an AI draft loses every trace of the epic it came from. */}
              <div className="flex flex-wrap items-center gap-2">
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
                    Part of <span className="font-mono">{task.parent_key}</span>
                  </button>
                ) : null}
              </div>
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
