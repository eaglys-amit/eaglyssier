import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useEffect, useState } from "react";

import type { Task } from "@/types/api";

/** Droppable id for the backlog column; sprints use `sprint-<id>`. */
export const BACKLOG_DROPPABLE = "backlog";
export const sprintDroppable = (sprintId: number) => `sprint-${sprintId}`;

/** Resolve a droppable id back to the sprint it represents (null = backlog). */
function containerSprintId(id: UniqueIdentifier): number | null | undefined {
  const raw = String(id);
  if (raw === BACKLOG_DROPPABLE) return null;
  if (raw.startsWith("sprint-")) return Number(raw.slice("sprint-".length));
  return undefined; // not a container — it's a task id
}

/**
 * Drag-and-drop for the board.
 *
 * Deliberately an *addition* to the Select + arrow controls rather than a
 * replacement. Below `lg` the two panes stack, so there is nowhere to drag to,
 * and the sensors are switched off there; the buttons carry the interaction on
 * narrow screens and remain the keyboard path everywhere.
 *
 * The wire contract stays positional: this computes the final ordering locally
 * and reports "put it after task N", so the server keeps owning rank values.
 */
export function useBoardDnd({
  tasks,
  onMove,
}: {
  /** Every task on the board, so a drop can be resolved without a refetch. */
  tasks: Task[];
  onMove: (taskId: number, sprintId: number | null, afterTaskId: number | null) => void;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);

  // Same breakpoint the panes use to stop sitting side by side.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const apply = () => setEnabled(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const sensors = useSensors(
    // 6px of travel before a drag starts, so a plain click still opens the task.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byId = new Map(tasks.map((t) => [t.id, t]));

  /** Tasks in one column, in board order, optionally excluding one. */
  const column = (sprintId: number | null, exclude?: number) =>
    tasks.filter((t) => t.sprint_id === sprintId && t.id !== exclude);

  const onDragStart = (event: DragStartEvent) => setActiveId(Number(event.active.id));

  const onDragCancel = () => setActiveId(null);

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = Number(active.id);
    const task = byId.get(taskId);
    if (!task) return;

    const overContainer = containerSprintId(over.id);
    const overTask = overContainer === undefined ? byId.get(Number(over.id)) : undefined;

    const targetSprint =
      overContainer !== undefined ? overContainer : (overTask?.sprint_id ?? null);
    // The target list without the card being dragged — the frame the drop is
    // resolved in, and the same one the server will renumber.
    const rest = column(targetSprint, taskId);

    let afterTaskId: number | null;
    if (!overTask || overTask.id === taskId) {
      // Dropped on the column itself (empty list, or the gap below the last
      // card) — append.
      afterTaskId = rest.length ? rest[rest.length - 1].id : null;
    } else {
      // Direction matters. Dragging a card DOWN onto its neighbour has to land
      // it *after* that neighbour, or the move is a no-op: "take its place" is
      // exactly where the card already was. Dragging up, or arriving from the
      // other column, lands before it — that's where you dropped it.
      const full = column(targetSprint);
      const fromIndex = full.findIndex((t) => t.id === taskId);
      const overIndex = full.findIndex((t) => t.id === overTask.id);
      const movingDown = fromIndex !== -1 && overIndex > fromIndex;

      if (movingDown) {
        afterTaskId = overTask.id;
      } else {
        const at = rest.findIndex((t) => t.id === overTask.id);
        afterTaskId = at > 0 ? rest[at - 1].id : null;
      }
    }

    // A drop that changes nothing shouldn't cost a request.
    const sourceFull = column(task.sprint_id);
    const sourceIndex = sourceFull.findIndex((t) => t.id === taskId);
    const currentAfter = sourceIndex > 0 ? sourceFull[sourceIndex - 1].id : null;
    if (targetSprint === task.sprint_id && afterTaskId === currentAfter) return;

    onMove(taskId, targetSprint, afterTaskId);
  };

  /** Spoken by the keyboard sensor, so a screen-reader user hears the outcome. */
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const t = byId.get(Number(active.id));
      return t ? `Picked up ${t.external_key ?? `#${t.id}`}.` : undefined;
    },
    onDragOver: ({ over }) => {
      if (!over) return;
      const sprintId = containerSprintId(over.id);
      if (sprintId === null) return "Over the backlog.";
      if (typeof sprintId === "number") return "Over the sprint.";
      const t = byId.get(Number(over.id));
      return t ? `Over ${t.external_key ?? `#${t.id}`}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const t = byId.get(Number(active.id));
      if (!t) return;
      if (!over) return `Returned ${t.external_key ?? `#${t.id}`} to its place.`;
      return `Moved ${t.external_key ?? `#${t.id}`}.`;
    },
    onDragCancel: ({ active }) => {
      const t = byId.get(Number(active.id));
      return t ? `Cancelled. ${t.external_key ?? `#${t.id}`} stayed put.` : undefined;
    },
  };

  return {
    enabled,
    sensors,
    activeId,
    activeTask: activeId != null ? (byId.get(activeId) ?? null) : null,
    announcements,
    onDragStart,
    onDragEnd,
    onDragCancel,
  };
}
