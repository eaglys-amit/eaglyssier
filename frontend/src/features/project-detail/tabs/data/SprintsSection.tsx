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
import {
  IntegrationSyncBar,
  IntegrationSyncStatus,
} from "@/features/project-detail/tabs/data/IntegrationSync";
import { SectionPanel } from "@/features/project-detail/tabs/data/SectionPanel";
import { api, ApiError } from "@/lib/api";
import { formatDate, taskLabel } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Sprint, Task } from "@/types/api";

/** Module-level so the prop identity is stable across renders. */
const JIRA = ["jira"];

/** No person = no filter; otherwise only tasks assigned to them. */
function byPerson(tasks: Task[], personId: number | null): Task[] {
  if (personId == null) return tasks;
  return tasks.filter((t) => t.assignee_member_id === personId);
}

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
            <TableCell className="font-mono text-xs">{taskLabel(t)}</TableCell>
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

export function SprintsSection({
  projectId,
  personId,
}: {
  projectId: number;
  personId: number | null;
}) {
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
  for (const t of byPerson(tasks ?? [], personId)) {
    const list = bySprint.get(t.sprint_id) ?? [];
    list.push(t);
    bySprint.set(t.sprint_id, list);
  }
  const backlog = bySprint.get(null) ?? [];
  const filtered = personId != null;

  return (
    <SectionPanel
      title="Sprints & tasks"
      count={sprints?.length}
      sync={<IntegrationSyncBar projectId={projectId} types={JIRA} />}
      subtitle={<IntegrationSyncStatus projectId={projectId} types={JIRA} />}
      actions={
        sprints?.length ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="size-4" /> Delete all
              </Button>
            }
            title="Delete all sprints?"
            description="Removes every sprint. Synced tasks go with them and a Jira re-sync recreates those; tasks created in Scrums are kept and fall back to the backlog."
            onConfirm={() => deleteAll.mutate()}
          />
        ) : null
      }
    >
      {!sprints?.length && !backlog.length ? (
        <EmptyState
          icon={CalendarRange}
          title="No sprints synced"
          hint="Sync Jira above to pull sprints and tasks."
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
                    {s.source === "local" ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        Local
                      </Badge>
                    ) : null}
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {formatDate(s.start_date)} → {formatDate(s.end_date)}
                    </span>
                    <Badge variant="secondary" className="ml-auto font-mono tabular-nums">
                      {filtered ? `${sprintTasks.length}/${s.task_count}` : sprintTasks.length}
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
                    description="Removes the sprint. Its synced tasks go too and a re-sync recreates them; tasks created in Scrums fall back to the backlog."
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
                  description="Removes the synced tasks that have no sprint; a Jira re-sync recreates them. Tasks created in Scrums are kept."
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
    </SectionPanel>
  );
}
