import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronUp,
  GitBranch,
  GripVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
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
import { formatPoints, taskLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BacklogSprintBucket, Task } from "@/types/api";

/** Sentinel for "the backlog" — a Select value can't be null or empty. */
const BACKLOG = "backlog";

/**
 * One row on the board.
 *
 * Three ways to move it, in order of how reliable they are: the sprint Select,
 * the up/down buttons, and — only when `draggable` — a drag handle. The first
 * two are the baseline because the panes stack below lg (nowhere to drag to)
 * and because they are the keyboard path; dragging is the shortcut on top.
 */
export function TaskCard({
  task,
  sprints,
  subtaskCount,
  isFirst,
  isLast,
  busy,
  draggable,
  onMove,
  onReorder,
  onEdit,
  onDelete,
}: {
  task: Task;
  sprints: BacklogSprintBucket[];
  subtaskCount: number;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  /** Wide viewports only — see useBoardDnd. */
  draggable: boolean;
  onMove: (sprintId: number | null) => void;
  onReorder: (direction: "up" | "down") => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [, setParams] = useSearchParams();
  const isLocal = task.source === "local";
  const isContainer = subtaskCount > 0;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable || busy,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-start gap-2 rounded-lg border bg-card px-2.5 py-2",
        // The card follows the cursor via DragOverlay; this one is the gap it left.
        isDragging && "opacity-40",
      )}
    >
      {draggable ? (
        // The grip is the ONLY drag activator. A whole-card activator would
        // swallow clicks on the title link, the Select, and the row's buttons.
        <button
          type="button"
          className="mt-1 cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
          <span className="sr-only">Reorder {taskLabel(task)}</span>
        </button>
      ) : null}

      <div className="flex shrink-0 flex-col">
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={isFirst || busy}
          onClick={() => onReorder("up")}
        >
          <ChevronUp className="size-3.5" />
          <span className="sr-only">Move {taskLabel(task)} up</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={isLast || busy}
          onClick={() => onReorder("down")}
        >
          <ChevronDown className="size-3.5" />
          <span className="sr-only">Move {taskLabel(task)} down</span>
        </Button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Opens the existing global TaskSheet, so a board row and a Data-tab
              row lead to the same detail view. */}
          <button
            type="button"
            className="truncate text-left text-sm font-medium hover:underline"
            onClick={() => setParams((p) => {
              const next = new URLSearchParams(p);
              next.set("task", String(task.id));
              return next;
            })}
          >
            {task.title}
          </button>
          {isLocal ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              Local
            </Badge>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{taskLabel(task)}</span>
          {taskCategoryBadge(task.status_category, task.status)}
          {task.story_points != null ? (
            <span className="font-mono tabular-nums">{formatPoints(task.story_points)} pts</span>
          ) : (
            <span className="italic">no estimate</span>
          )}
          {isContainer ? (
            <span className="inline-flex items-center gap-1">
              <GitBranch className="size-3" />
              {subtaskCount} {subtaskCount === 1 ? "subtask" : "subtasks"}
            </span>
          ) : null}
          {task.assignee_name ? <span className="truncate">{task.assignee_name}</span> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Select
          value={task.sprint_id === null ? BACKLOG : String(task.sprint_id)}
          onValueChange={(v) => onMove(v === BACKLOG ? null : Number(v))}
          disabled={busy}
        >
          <SelectTrigger size="sm" className="w-[9.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BACKLOG}>Backlog</SelectItem>
            {sprints.map((s) => (
              <SelectItem key={s.sprint_id} value={String(s.sprint_id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="ghost" size="icon-sm" onClick={onEdit}>
          <Pencil className="size-3.5" />
          <span className="sr-only">Edit {taskLabel(task)}</span>
        </Button>

        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
              <Trash2 className="size-3.5" />
              <span className="sr-only">Delete {taskLabel(task)}</span>
            </Button>
          }
          title={`Delete ${taskLabel(task)}?`}
          description={
            isContainer
              ? `Its ${subtaskCount} ${subtaskCount === 1 ? "subtask" : "subtasks"} will be kept and moved to the top level.`
              : isLocal
                ? "This task was created here, so no sync can bring it back."
                : "A Jira re-sync will recreate this task."
          }
          onConfirm={onDelete}
        />
      </div>
    </div>
  );
}
