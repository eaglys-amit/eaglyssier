import { DndContext, DragOverlay, closestCorners } from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation } from "@tanstack/react-query";
import {
  Inbox,
  LayoutList,
  ListPlus,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  SquareCheck,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  BacklogSprintBucket,
  Sprint,
  SprintCompleteOut,
  SprintCreateIn,
  Task,
} from "@/types/api";

import { IntegrationSyncBar } from "../data/IntegrationSync";
import { SectionPanel } from "../data/SectionPanel";
import { CommitmentMeter } from "./CommitmentMeter";
import { DropColumn } from "./DropColumn";
import { SprintDialog } from "./SprintDialog";
import { TaskCard } from "./TaskCard";
import { TaskDialog } from "./TaskDialog";
import { useBoard } from "./useBoard";

// Module-level so the array identity is stable across renders, as in
// SprintsSection — IntegrationSyncBar filters on it.
const JIRA = ["jira"];
import { BACKLOG_DROPPABLE, sprintDroppable, useBoardDnd } from "./useBoardDnd";

/**
 * Backlog on the left, the selected sprint on the right, one commitment meter
 * between the sprint header and its list.
 *
 * Planning is moving work across that divide, so both sides are one surface
 * rather than two views. Reuses the Data tab's SectionPanel so the two tabs
 * read as the same product.
 */
export function BoardView({
  projectId,
  sprintId,
  onSelectSprint,
}: {
  projectId: number;
  sprintId: number | null;
  onSelectSprint: (id: number | null) => void;
}) {
  const {
    board,
    isPending,
    error,
    createTask,
    patchTask,
    linkKey,
    deleteTask,
    moveTask,
    isFetching,
    invalidateAll,
  } = useBoard(projectId);

  const [taskDialog, setTaskDialog] = useState<{ task: Task | null; parent: Task | null } | null>(
    null,
  );
  const [sprintDialog, setSprintDialog] = useState<{ sprint: BacklogSprintBucket | null } | null>(
    null,
  );
  // Backlog scope. Both on by default — see visibleBacklog for why.
  const [todoOnly, setTodoOnly] = useState(true);
  const [leavesOnly, setLeavesOnly] = useState(true);

  const sprints = board?.sprints ?? [];
  // Fall back to the first sprint so the right pane is never empty just because
  // ?sprint= hasn't been set yet.
  const active = sprints.find((s) => s.sprint_id === sprintId) ?? sprints[0] ?? null;

  const createSprint = useMutation({
    mutationFn: (body: SprintCreateIn) =>
      api.post<Sprint>(`/projects/${projectId}/sprints`, body),
    onSuccess: (sprint) => {
      invalidateAll();
      onSelectSprint(sprint.id);
      setSprintDialog(null);
      toast.success(`Created ${sprint.name}`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not create the sprint"),
  });

  const patchSprint = useMutation({
    mutationFn: ({ id, body }: { id: number; body: SprintCreateIn }) =>
      api.patch<Sprint>(`/projects/${projectId}/sprints/${id}`, body),
    onSuccess: () => {
      invalidateAll();
      setSprintDialog(null);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save the sprint"),
  });

  const startSprint = useMutation({
    mutationFn: (id: number) => api.post<Sprint>(`/projects/${projectId}/sprints/${id}/start`),
    onSuccess: (sprint) => {
      invalidateAll();
      toast.success(
        `${sprint.name} started — ${formatPoints(sprint.committed_points)} pts committed`,
      );
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start the sprint"),
  });

  const completeSprint = useMutation({
    mutationFn: (id: number) =>
      api.post<SprintCompleteOut>(`/projects/${projectId}/sprints/${id}/complete`, {
        move_incomplete_to: null,
      }),
    onSuccess: (result) => {
      invalidateAll();
      toast.success(
        `Closed: ${result.completed_tasks} done (${formatPoints(result.completed_points)} pts), ` +
          `${result.moved_tasks} moved to the backlog`,
      );
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not complete the sprint"),
  });

  const deleteSprint = useMutation({
    mutationFn: (id: number) => api.delete(`/projects/${projectId}/sprints/${id}`),
    onSuccess: () => {
      invalidateAll();
      onSelectSprint(null);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete the sprint"),
  });

  // Subtask counts for every task on the board, so a row can say "3 subtasks"
  // and the delete confirmation can warn about promotion.
  const subtaskCounts = useMemo(() => {
    const counts = new Map<number, number>();
    const all = [...(board?.backlog ?? []), ...sprints.flatMap((s) => s.tasks)];
    for (const t of all) {
      if (t.parent_id != null) counts.set(t.parent_id, (counts.get(t.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [board, sprints]);

  const allTasks = useMemo(
    () => [...(board?.backlog ?? []), ...sprints.flatMap((s) => s.tasks)],
    [board, sprints],
  );

  /**
   * The backlog column is the pre-planning queue — what the team refines,
   * estimates, and then copies into the tracker — so it defaults to unplanned
   * **To Do leaves**. That is the same scope poker offers by default; see
   * poker.candidate_tasks, which this deliberately mirrors rather than
   * inventing a second notion of "ready".
   *
   * Containers are out because their points roll up from their children: a
   * generated epic in this list is a row nobody can estimate or copy, and it
   * was the reason every epic appeared to be sitting unplanned. The Epics view
   * is where that structure lives now.
   *
   * Both filters are switchable and the payload is always the whole backlog, so
   * no task is ever unreachable from the only surface that can plan it.
   */
  const visibleBacklog = useMemo(() => {
    const all = board?.backlog ?? [];
    return all.filter(
      (t) =>
        (!todoOnly || t.status_category === "todo") &&
        (!leavesOnly || (subtaskCounts.get(t.id) ?? 0) === 0),
    );
  }, [board, todoOnly, leavesOnly, subtaskCounts]);

  // Points for what's actually on screen, by the same containers-score-zero
  // rule the server uses (see backlog.build_backlog). Without this the header
  // would total rows the filter has hidden.
  const visiblePoints = useMemo(
    () =>
      visibleBacklog.reduce(
        (sum, t) => sum + ((subtaskCounts.get(t.id) ?? 0) > 0 ? 0 : (t.story_points ?? 0)),
        0,
      ),
    [visibleBacklog, subtaskCounts],
  );

  const dnd = useBoardDnd({
    tasks: allTasks,
    onMove: (taskId, sprintId, afterTaskId) =>
      moveTask.mutate({ taskId, body: { sprint_id: sprintId, after_task_id: afterTaskId } }),
  });

  if (error) return <ErrorAlert message={(error as ApiError).detail} />;
  if (isPending || !board) return <TableSkeleton rows={8} />;

  const busy =
    moveTask.isPending || patchTask.isPending || deleteTask.isPending || linkKey.isPending;

  // What the two chips are holding back — reported in the header so a short
  // list never reads as work having gone missing.
  const hiddenCount = board.backlog.length - visibleBacklog.length;

  /** Reorder within the current list by re-anchoring one slot up or down. */
  const reorder = (list: Task[], task: Task, direction: "up" | "down") => {
    const index = list.findIndex((t) => t.id === task.id);
    if (index === -1) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= list.length) return;
    // Moving up means landing after whatever precedes the neighbour; moving
    // down means landing after the neighbour itself.
    const anchor = direction === "up" ? (list[index - 2]?.id ?? null) : list[index + 1].id;
    moveTask.mutate({ taskId: task.id, body: { sprint_id: task.sprint_id, after_task_id: anchor } });
  };

  const renderList = (list: Task[], droppableId: string, emptyNode: React.ReactNode) => (
    // The column is a drop target in its own right, so a task can be dropped
    // into an empty list or below the last card.
    <DropColumn id={droppableId} empty={list.length === 0}>
      {list.length === 0 ? (
        emptyNode
      ) : (
        <SortableContext items={list.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {list.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                draggable={dnd.enabled}
                sprints={sprints}
                subtaskCount={subtaskCounts.get(task.id) ?? 0}
                isFirst={list[0].id === task.id}
                isLast={list[list.length - 1].id === task.id}
                busy={busy}
                onMove={(target) =>
                  moveTask.mutate({
                    taskId: task.id,
                    body: { sprint_id: target, after_task_id: null },
                  })
                }
                onReorder={(direction) => reorder(list, task, direction)}
                onEdit={() => setTaskDialog({ task, parent: null })}
                onLinkKey={(key) =>
                  linkKey.mutate({ taskId: task.id, body: { external_key: key } })
                }
                onDelete={() => deleteTask.mutate({ taskId: task.id })}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </DropColumn>
  );

  return (
    <DndContext
      sensors={dnd.sensors}
      // closestCorners beats closestCenter for tall columns: it picks the card
      // whose edge you're nearest, which is what a list drag feels like.
      collisionDetection={closestCorners}
      accessibility={{ announcements: dnd.announcements }}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <div className="flex flex-col gap-6 lg:h-full">
        <div className="flex flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row">
          {/* ---- backlog ------------------------------------------------- */}
          <div className="min-w-0 lg:h-full lg:basis-1/2">
            <SectionPanel
              title="Backlog"
              count={visibleBacklog.length}
              // The same Jira trigger the Data tab uses, in the slot SectionPanel
              // keeps for it. It belongs here because this is where the planning
              // flow ends: a task linked to a hand-made Jira issue is only
              // adopted when a sync runs (see backlog.link_external_key).
              sync={<IntegrationSyncBar projectId={projectId} types={JIRA} />}
              subtitle={
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {/* Both totals while filtering, plus what's hidden, so a
                      shorter list never reads as work having gone missing. */}
                  {hiddenCount > 0
                    ? `${formatPoints(visiblePoints)} pts ready · ${formatPoints(board.backlog_points)} pts unplanned · ${hiddenCount} hidden`
                    : `${formatPoints(board.backlog_points)} pts unplanned`}
                </span>
              }
              actions={
                <div className="flex items-center gap-1">
                  {/* Re-reads what's already in our database, unlike Sync beside
                      it, which goes out to Jira first. Worth having separately:
                      a scheduled sync or a teammate's edit lands without this
                      tab knowing, and the board deliberately doesn't poll. */}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={isFetching}
                    title="Reload the board"
                    onClick={() => invalidateAll()}
                  >
                    <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
                    <span className="sr-only">Reload the board</span>
                  </Button>
                  <Button
                    size="xs"
                    variant={todoOnly ? "secondary" : "ghost"}
                    aria-pressed={todoOnly}
                    title="Show only To Do tasks — work already in progress or done isn't waiting to be planned."
                    onClick={() => setTodoOnly((on) => !on)}
                  >
                    To Do
                  </Button>
                  <Button
                    size="xs"
                    variant={leavesOnly ? "secondary" : "ghost"}
                    aria-pressed={leavesOnly}
                    title="Hide epics and other containers — their points roll up from their children. See the Epics view for the structure they hold."
                    onClick={() => setLeavesOnly((on) => !on)}
                  >
                    Leaves
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setTaskDialog({ task: null, parent: null })}
                  >
                    <Plus className="size-3.5" /> Task
                  </Button>
                </div>
              }
            >
              {renderList(
                visibleBacklog,
                BACKLOG_DROPPABLE,
                hiddenCount > 0 ? (
                  // The list isn't empty, the filter just matched nothing —
                  // saying "nothing in the backlog" here would be a lie.
                  <EmptyState
                    icon={Inbox}
                    title="Nothing ready to plan"
                    hint={`${hiddenCount} backlog ${hiddenCount === 1 ? "task is" : "tasks are"} hidden by the To Do and Leaves filters.`}
                  />
                ) : (
                  <EmptyState
                    icon={Inbox}
                    title="Nothing in the backlog"
                    hint="Create a task here, or pull one out of a sprint."
                  />
                ),
              )}
            </SectionPanel>
          </div>

          {/* ---- selected sprint ----------------------------------------- */}
          <div className="min-w-0 lg:h-full lg:basis-1/2">
            <SectionPanel
              // Static label: the switcher beside it already names the sprint, and
              // repeating it in the title just doubled the same string in the header.
              title="Sprint"
              count={active?.tasks.length}
              subtitle={
                active ? (
                  <CommitmentMeter
                    projectId={projectId}
                    committed={active.committed_points}
                    completed={active.completed_points}
                    capacity={active.capacity_points}
                    unestimated={
                      active.tasks.filter(
                        (t) => t.story_points == null && (subtaskCounts.get(t.id) ?? 0) === 0,
                      ).length
                    }
                  />
                ) : null
              }
              actions={
                <div className="flex items-center gap-1">
                  {sprints.length ? (
                    <SprintSwitcher
                      sprints={sprints}
                      activeId={active?.sprint_id ?? null}
                      onSelect={onSelectSprint}
                    />
                  ) : null}
                  {active?.source === "local" ? (
                    <>
                      {active.state !== "active" && active.state !== "closed" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={startSprint.isPending}
                          onClick={() => startSprint.mutate(active.sprint_id)}
                        >
                          <Play className="size-3.5" /> Start
                        </Button>
                      ) : null}
                      {active.state === "active" ? (
                        <ConfirmDialog
                          trigger={
                            <Button size="xs" variant="outline">
                              <SquareCheck className="size-3.5" /> Complete
                            </Button>
                          }
                          title={`Complete ${active.name}?`}
                          description="Unfinished tasks move back to the backlog. Completed work stays on the sprint."
                          confirmLabel="Complete sprint"
                          destructive={false}
                          onConfirm={() => completeSprint.mutate(active.sprint_id)}
                        />
                      ) : null}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setSprintDialog({ sprint: active })}
                      >
                        <Pencil className="size-3.5" />
                        <span className="sr-only">Edit {active.name}</span>
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button size="icon-xs" variant="ghost">
                            <Trash2 className="size-3.5" />
                            <span className="sr-only">Delete {active.name}</span>
                          </Button>
                        }
                        title={`Delete ${active.name}?`}
                        description="Its tasks move back to the backlog — nothing is destroyed."
                        onConfirm={() => deleteSprint.mutate(active.sprint_id)}
                      />
                    </>
                  ) : null}
                  <Button size="xs" variant="outline" onClick={() => setSprintDialog({ sprint: null })}>
                    <ListPlus className="size-3.5" /> Sprint
                  </Button>
                </div>
              }
            >
              {active ? (
                renderList(
                  active.tasks,
                  sprintDroppable(active.sprint_id),
                  <EmptyState
                    icon={LayoutList}
                    title="Nothing planned yet"
                    hint="Move work in from the backlog using each row's sprint picker."
                  />,
                )
              ) : (
                <EmptyState
                  icon={LayoutList}
                  title="No sprints yet"
                  hint="Create one to start planning, or sync Jira to pull existing sprints."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSprintDialog({ sprint: null })}
                    >
                      <ListPlus className="size-4" /> New sprint
                    </Button>
                  }
                />
              )}
            </SectionPanel>
          </div>
        </div>

        {taskDialog ? (
          <TaskDialog
            projectId={projectId}
            open
            onOpenChange={(open) => {
              if (!open) setTaskDialog(null);
            }}
            taskId={taskDialog.task?.id ?? null}
            parent={taskDialog.parent}
            defaultSprintId={active?.sprint_id ?? null}
            busy={createTask.isPending || patchTask.isPending}
            onSubmit={(body) => {
              const done = { onSuccess: () => setTaskDialog(null) };
              if (taskDialog.task) {
                patchTask.mutate({ taskId: taskDialog.task.id, body }, done);
              } else {
                createTask.mutate(body, done);
              }
            }}
          />
        ) : null}

        {/* A copy of the card under the cursor. Rendered outside the panels so it
            isn't clipped by their overflow-y-auto. */}
        <DragOverlay modifiers={[restrictToWindowEdges]} dropAnimation={null}>
          {dnd.activeTask ? (
            <div className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 shadow-lg">
              <span className="font-mono text-xs text-muted-foreground">
                {dnd.activeTask.external_key ?? `#${dnd.activeTask.id}`}
              </span>
              <span className="max-w-64 truncate text-sm font-medium">
                {dnd.activeTask.title}
              </span>
            </div>
          ) : null}
        </DragOverlay>

        {sprintDialog ? (
          <SprintDialog
            open
            onOpenChange={(open) => {
              if (!open) setSprintDialog(null);
            }}
            sprint={sprintDialog.sprint}
            busy={createSprint.isPending || patchSprint.isPending}
            onSubmit={(body) => {
              if (sprintDialog.sprint) {
                patchSprint.mutate({ id: sprintDialog.sprint.sprint_id, body });
              } else {
                createSprint.mutate(body);
              }
            }}
          />
        ) : null}
      </div>
    </DndContext>
  );
}

function SprintSwitcher({
  sprints,
  activeId,
  onSelect,
}: {
  sprints: BacklogSprintBucket[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <Select
      value={activeId != null ? String(activeId) : undefined}
      onValueChange={(v) => onSelect(Number(v))}
    >
      <SelectTrigger size="sm" className="h-6 w-[11rem] text-xs">
        <SelectValue placeholder="Pick a sprint" />
      </SelectTrigger>
      <SelectContent>
        {sprints.map((s) => (
          <SelectItem key={s.sprint_id} value={String(s.sprint_id)}>
            {s.name}
            {s.state === "active" ? " · active" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
