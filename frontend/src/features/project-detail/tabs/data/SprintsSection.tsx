import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, ChevronDown, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import type { Sprint, Task } from "@/types/api";

function TaskTable({ tasks }: { tasks: Task[] }) {
  const [params, setParams] = useSearchParams();
  if (!tasks.length) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">No tasks.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Key</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-40">Assignee</TableHead>
          <TableHead className="w-16 text-right">SP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((t) => (
          <TableRow
            key={t.id}
            className="cursor-pointer"
            onClick={() => {
              params.set("task", String(t.id));
              setParams(params);
            }}
          >
            <TableCell className="font-mono text-xs">{t.external_key}</TableCell>
            <TableCell className="max-w-md truncate">{t.title}</TableCell>
            <TableCell>{taskCategoryBadge(t.status_category, t.status)}</TableCell>
            <TableCell className="truncate text-muted-foreground">
              {t.assignee_name || "—"}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {t.story_points ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function SprintsSection({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { data: sprints } = useQuery({
    queryKey: qk.sprints(projectId),
    queryFn: () => api.get<Sprint[]>(`/projects/${projectId}/sprints`),
  });
  const { data: tasks } = useQuery({
    queryKey: qk.tasks(projectId),
    queryFn: () => api.get<Task[]>(`/projects/${projectId}/tasks`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.sprints(projectId) });
    qc.invalidateQueries({ queryKey: qk.tasks(projectId) });
  };
  const deleteSprint = useMutation({
    mutationFn: (sprintId: number) => api.delete(`/sprints/${sprintId}`),
    onSuccess: () => {
      invalidate();
      toast.success("Sprint deleted");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete sprint"),
  });
  const deleteAll = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/sprints`),
    onSuccess: () => {
      invalidate();
      toast.success("All sprints deleted");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete sprints"),
  });
  const deleteBacklog = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/backlog`),
    onSuccess: () => {
      invalidate();
      toast.success("Backlog tasks deleted");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete backlog tasks"),
  });

  const bySprint = new Map<number | null, Task[]>();
  for (const t of tasks ?? []) {
    const list = bySprint.get(t.sprint_id) ?? [];
    list.push(t);
    bySprint.set(t.sprint_id, list);
  }
  const backlog = bySprint.get(null) ?? [];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Sprints & tasks</h2>
        {sprints?.length ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="size-4" /> Delete all sprints
              </Button>
            }
            title="Delete all sprints?"
            description="Removes every sprint and its tasks (backlog tasks are kept). A Jira re-sync recreates them."
            onConfirm={() => deleteAll.mutate()}
          />
        ) : null}
      </div>

      {!sprints?.length && !backlog.length ? (
        <EmptyState
          icon={CalendarRange}
          title="No sprints synced"
          hint="Connect and sync Jira to pull sprints and tasks."
        />
      ) : (
        <div className="space-y-2">
          {(sprints ?? []).map((s) => {
            const sprintTasks = bySprint.get(s.id) ?? [];
            return (
              <Collapsible key={s.id} className="rounded-lg border bg-card">
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    {s.state ? (
                      <StatusBadge
                        variant={s.state === "active" ? "running" : "neutral"}
                        label={s.state}
                      />
                    ) : null}
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {formatDate(s.start_date)} → {formatDate(s.end_date)}
                    </span>
                    <Badge variant="secondary" className="ml-auto font-mono tabular-nums">
                      {sprintTasks.length}
                    </Badge>
                  </CollapsibleTrigger>
                  <ConfirmDialog
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                        <span className="sr-only">Delete sprint</span>
                      </Button>
                    }
                    title={`Delete sprint “${s.name}”?`}
                    description="Removes the sprint and its tasks; a re-sync recreates them."
                    onConfirm={() => deleteSprint.mutate(s.id)}
                  />
                </div>
                <CollapsibleContent>
                  <div className="border-t">
                    {s.goal ? (
                      <p className="px-4 pt-3 text-xs text-muted-foreground">Goal: {s.goal}</p>
                    ) : null}
                    <TaskTable tasks={sprintTasks} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}

          {backlog.length ? (
            <Collapsible className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 px-4 py-2.5">
                <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                  <span className="text-sm font-medium">Backlog</span>
                  <span className="text-xs text-muted-foreground">tasks without a sprint</span>
                  <Badge variant="secondary" className="ml-auto font-mono tabular-nums">
                    {backlog.length}
                  </Badge>
                </CollapsibleTrigger>
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Delete backlog tasks</span>
                    </Button>
                  }
                  title="Delete all backlog tasks?"
                  description="Removes every task without a sprint; a Jira re-sync recreates them."
                  onConfirm={() => deleteBacklog.mutate()}
                />
              </div>
              <CollapsibleContent>
                <div className="border-t">
                  <TaskTable tasks={backlog} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      )}
    </section>
  );
}
