import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, GripVertical, Inbox, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { formatPoints, taskLabel } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { BacklogBoard, Milestone, TaskNode } from "@/types/api";

import { SectionPanel } from "../data/SectionPanel";
import { useMilestones } from "../milestones/useMilestones";
import { TaskDialog } from "./TaskDialog";
import { TaskTreeView } from "./TaskTreeView";
import { isContainer } from "./task-kind";
import { useBoard } from "./useBoard";

/** Droppable id for the unlinked pane — every other target is a task id. */
const UNLINKED_DROPPABLE = "epics-unlinked";

/**
 * Whether a root belongs in the Epics pane.
 *
 * Deliberately looser than the rollup's definition of a container (see
 * tasks.leaf_only, which is purely "has children"): an epic you just created
 * has no children yet, and it would be absurd for it to appear under
 * "Unlinked tasks" until you fill it. Shared with the board, which keeps the
 * same rows out of its backlog — see task-kind.
 */
function isEpic(node: TaskNode): boolean {
  return isContainer(node, node.children.length);
}

/**
 * The project's work by structure: unlinked tasks on the left, epics and their
 * subtrees on the right.
 *
 * Two panes for the reason the board has two — the interesting act is moving
 * work across the divide. There it's backlog→sprint (placement); here it's
 * task→epic (structure). A subtree crosses the backlog/sprint line freely, which
 * is why this can't live inside the board's panes: a tree rendered under a
 * heading that said "Backlog" kept showing done work from sprints.
 *
 * Ranking and move-to-sprint stay on the board. What's here is what you need to
 * judge a breakdown and fix it: group a loose task, edit a row, drop a branch.
 */
export function EpicsView({ projectId }: { projectId: number }) {
  // Reuses the board's mutations so an edit here invalidates exactly what an
  // edit there does — including this view's own query.
  const { createTask, patchTask, deleteTask, isFetching, invalidateAll } = useBoard(projectId);
  // The milestone link cascades into the epic's subtree — that behaviour lives
  // in the service, so reuse these rather than PATCHing milestone_id directly.
  const { linkTasks, unlinkTask } = useMilestones(projectId);
  // `null` = the New epic dialog; a node = editing that row. The dialog fetches
  // full detail by id, so the node itself is only needed for its id.
  const [dialog, setDialog] = useState<{ epic: TaskNode | null } | null>(null);

  const { data: tree, isPending } = useQuery({
    queryKey: qk.taskTree(projectId),
    queryFn: () => api.get<TaskNode[]>(`/projects/${projectId}/task-tree`),
    enabled: Number.isFinite(projectId),
  });

  const { data: milestones } = useQuery({
    queryKey: qk.milestones(projectId),
    queryFn: () => api.get<Milestone[]>(`/projects/${projectId}/milestones`),
    enabled: Number.isFinite(projectId),
  });

  // Sprint names for the unlinked rows. The board's payload is already cached by
  // the Scrums tab, so this costs nothing and can't disagree with it.
  const { data: board } = useQuery({
    queryKey: qk.board(projectId),
    queryFn: () => api.get<BacklogBoard>(`/projects/${projectId}/backlog-board`),
    enabled: Number.isFinite(projectId),
  });

  const roots = useMemo(() => tree ?? [], [tree]);
  const epics = useMemo(() => roots.filter(isEpic), [roots]);
  const unlinked = useMemo(() => roots.filter((n) => !isEpic(n)), [roots]);

  // Flat index of the whole forest, for resolving a drop and for rejecting one
  // that would nest a node inside itself.
  const byId = useMemo(() => {
    const map = new Map<number, TaskNode>();
    const walk = (nodes: TaskNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node);
        walk(node.children);
      }
    };
    walk(roots);
    return map;
  }, [roots]);

  // Same breakpoint the board uses: below it the panes stack, so there's nowhere
  // to drag to. The per-row Epic select carries the interaction there, and is
  // the keyboard path everywhere.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const sensors = useSensors(
    // 6px before a drag starts, so a plain click still behaves like a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const subtreeOf = (id: number): Set<number> => {
    const out = new Set<number>();
    const walk = (node?: TaskNode) => {
      if (!node) return;
      out.add(node.id);
      node.children.forEach(walk);
    };
    walk(byId.get(id));
    return out;
  };

  /** Re-parent, guarding the two moves that would be wrong or pointless. */
  const reparent = (taskId: number, parentId: number | null) => {
    const node = byId.get(taskId);
    if (!node || parentId === taskId) return;
    // A move that changes nothing shouldn't cost a request.
    if ((node.parent_id ?? null) === parentId) return;
    // The server rejects this too (backlog._check_parent), but catching it here
    // means a clear message instead of a round-trip and a 422.
    if (parentId != null && subtreeOf(taskId).has(parentId)) {
      toast.error(`${taskLabel(node)} can't move inside its own subtree.`);
      return;
    }
    patchTask.mutate({ taskId, body: { parent_id: parentId } });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    reparent(
      Number(active.id),
      over.id === UNLINKED_DROPPABLE ? null : Number(over.id),
    );
  };

  const setMilestone = (node: TaskNode, milestoneId: number | null) => {
    // Linking cascades into the epic's subtree server-side, and so does
    // unlinking — see milestones.assign_tasks for why the rollup needs it.
    if (milestoneId === null) {
      if (node.milestone_id != null) {
        unlinkTask.mutate({ milestoneId: node.milestone_id, taskId: node.id });
      }
      return;
    }
    linkTasks.mutate({ milestoneId, taskIds: [node.id] });
  };

  // Roots only: rollup_points already includes every descendant, so summing the
  // whole tree would count leaves twice.
  const epicPoints = epics.reduce((sum, n) => sum + (n.rollup_points ?? 0), 0);
  const unlinkedPoints = unlinked.reduce((sum, n) => sum + (n.story_points ?? 0), 0);
  const draggable = wide && !patchTask.isPending;

  if (isPending) return <TableSkeleton rows={8} />;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-6 lg:h-full lg:min-h-0 lg:flex-row">
        {/* ---- unlinked ------------------------------------------------- */}
        <div className="min-w-0 lg:h-full lg:basis-2/5">
          <UnlinkedPane
            tasks={unlinked}
            epics={epics}
            points={unlinkedPoints}
            draggable={draggable}
            sprintName={(id) =>
              id === null
                ? "Backlog"
                : board?.sprints.find((s) => s.sprint_id === id)?.name ?? `Sprint ${id}`
            }
            onSetEpic={reparent}
          />
        </div>

        {/* ---- epics ---------------------------------------------------- */}
        <div className="min-w-0 lg:h-full lg:basis-3/5">
          <SectionPanel
            title="Epics"
            count={epics.length}
            subtitle={
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatPoints(epicPoints)} pts rolled up
              </span>
            }
            actions={
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={isFetching}
                  title="Reload"
                  onClick={() => invalidateAll()}
                >
                  <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
                  <span className="sr-only">Reload the tree</span>
                </Button>
                <Button size="xs" variant="outline" onClick={() => setDialog({ epic: null })}>
                  <Plus className="size-3.5" /> Epic
                </Button>
              </div>
            }
          >
            {!epics.length ? (
              <EmptyState
                icon={GitBranch}
                title="No epics yet"
                hint="Create one here, or draft a whole breakdown on the AI tab."
              />
            ) : (
              <TaskTreeView
                nodes={epics}
                draggable={draggable}
                milestones={milestones}
                onEdit={(node) => setDialog({ epic: node })}
                onDelete={(node, cascade) => deleteTask.mutate({ taskId: node.id, cascade })}
                onSetMilestone={setMilestone}
              />
            )}
          </SectionPanel>
        </div>
      </div>

      {dialog ? (
        <TaskDialog
          projectId={projectId}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          taskId={dialog.epic?.id ?? null}
          parent={null}
          defaultSprintId={dialog.epic?.sprint_id ?? null}
          // A new row created from this view is an epic until someone says
          // otherwise; editing an existing one keeps whatever type it has.
          defaultIssueType="Epic"
          busy={createTask.isPending || patchTask.isPending}
          onSubmit={(body) => {
            const done = { onSuccess: () => setDialog(null) };
            if (dialog.epic) {
              patchTask.mutate({ taskId: dialog.epic.id, body }, done);
            } else {
              createTask.mutate(body, done);
            }
          }}
        />
      ) : null}
    </DndContext>
  );
}

/**
 * Top-level work that belongs to no epic.
 *
 * Also the drop target for taking a task *out* of an epic — which is why it's a
 * pane rather than a list tucked under the tree. Every target inside the tree
 * means "become this row's child", so un-parenting needs somewhere of its own,
 * and "back to the unlinked pile" is a place a person can already point at.
 *
 * No milestone selector here on purpose: a task's milestone follows its epic
 * (see backlog.patch_task), so the useful next step for one of these rows is
 * picking an epic. A task that genuinely belongs to a milestone without one can
 * still be linked from its detail sheet or the milestone's own picker.
 */
function UnlinkedPane({
  tasks,
  epics,
  points,
  draggable,
  sprintName,
  onSetEpic,
}: {
  tasks: TaskNode[];
  epics: TaskNode[];
  points: number;
  draggable: boolean;
  sprintName: (sprintId: number | null) => string;
  onSetEpic: (taskId: number, epicId: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNLINKED_DROPPABLE });

  return (
    <SectionPanel
      title="Unlinked tasks"
      count={tasks.length}
      subtitle={
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatPoints(points)} pts under no epic
        </span>
      }
    >
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-24 rounded-lg transition-colors",
          isOver && "bg-primary/5 ring-2 ring-primary ring-inset",
        )}
      >
        {!tasks.length ? (
          <EmptyState
            icon={Inbox}
            title="Everything is under an epic"
            hint={
              draggable
                ? "Drop a task here to take it back out of its epic."
                : "Tasks with no epic show up here."
            }
          />
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <UnlinkedRow
                key={task.id}
                task={task}
                epics={epics}
                draggable={draggable}
                sprintName={sprintName}
                onSetEpic={onSetEpic}
              />
            ))}
          </div>
        )}
      </div>
    </SectionPanel>
  );
}

function UnlinkedRow({
  task,
  epics,
  draggable,
  sprintName,
  onSetEpic,
}: {
  task: TaskNode;
  epics: TaskNode[];
  draggable: boolean;
  sprintName: (sprintId: number | null) => string;
  onSetEpic: (taskId: number, epicId: number | null) => void;
}) {
  const drag = useDraggable({ id: task.id, disabled: !draggable });

  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-2.5 py-2",
        drag.isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        {draggable ? (
          // Grip-only activator, as everywhere else: a row-wide one would
          // swallow the Select sitting in the same row.
          <button
            type="button"
            ref={drag.setNodeRef}
            className="mt-0.5 shrink-0 cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
            {...drag.attributes}
            {...drag.listeners}
          >
            <GripVertical className="size-4" />
            <span className="sr-only">Move {taskLabel(task)} into an epic</span>
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{taskLabel(task)}</span>
            <Badge variant="outline" className="text-[10px] font-normal">
              {sprintName(task.sprint_id)}
            </Badge>
            {taskCategoryBadge(task.status_category, task.status)}
            <span className="font-mono tabular-nums">
              {task.story_points == null ? "no estimate" : `${formatPoints(task.story_points)} pts`}
            </span>
          </div>
        </div>

        {/* Never shows a selection: picking an epic moves the row out of this
            pane, so the control only ever needs its placeholder. */}
        <Select
          value={undefined}
          disabled={!epics.length}
          onValueChange={(v) => onSetEpic(task.id, Number(v))}
        >
          <SelectTrigger size="sm" className="h-7 w-36 shrink-0 text-xs">
            <SelectValue placeholder={epics.length ? "Pick an epic" : "No epics yet"} />
          </SelectTrigger>
          <SelectContent>
            {/* No "None" item: these rows are already under nothing, so the only
                move available from here is joining an epic. */}
            {epics.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {taskLabel(e)} · {e.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
