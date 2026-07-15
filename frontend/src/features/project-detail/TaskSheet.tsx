import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { KpiStat } from "@/components/shared/KpiStat";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { TaskDetail } from "@/types/api";

/** Slide-over task detail bound to the ?task= search param (works from any tab). */
export function TaskSheet() {
  const [params, setParams] = useSearchParams();
  const taskId = Number(params.get("task"));
  const open = Number.isFinite(taskId) && taskId > 0;

  const { data: task, isPending, error } = useQuery({
    queryKey: qk.task(taskId),
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: open,
  });

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
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
