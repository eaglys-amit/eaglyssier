import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Play, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PokerQueueItem, PokerSessionDetail } from "@/types/api";

/**
 * The session queue: what's been estimated, what's on the table, and what's left.
 *
 * Two facilitator-only controls, and they do different jobs. **Estimate this**
 * puts a task on the table right now — nothing is selected automatically, so
 * this is the only way a round starts. **Dragging** sets the running order the
 * room works through, which is planning rather than an immediate action.
 *
 * Filtering and dragging deliberately don't compose (see `canDrag`); selecting
 * works under any filter, which is what makes searching for a task and putting
 * it on the table a single gesture.
 */

type StatusFilter = "all" | "pending" | "revealed" | "applied";

/** An AI proposal nobody has agreed yet — the queue's most interesting row. */
function isProposed(item: PokerQueueItem): boolean {
  return item.round_status !== "applied" && item.story_points != null;
}

export function PokerQueue({
  session,
  isHost,
  busy,
  onMove,
  onSelect,
}: {
  session: PokerSessionDetail;
  isHost: boolean;
  busy: boolean;
  onMove: (taskId: number, afterTaskId: number | null) => void;
  onSelect: (taskId: number) => void;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  // "" = any epic. Task ids are numbers but Select works in strings.
  const [epic, setEpic] = useState("");
  const [proposedOnly, setProposedOnly] = useState(false);
  const [search, setSearch] = useState("");
  // Same breakpoint the board uses to stop offering drag: below it there's not
  // enough room for the gesture to be anything but a mis-scroll.
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /**
   * The epics actually present in this queue, in the order they first appear —
   * which is queue order, so the dropdown reads the way the list does. Built
   * from the rows rather than fetched: a filter offering epics that aren't here
   * would just be a list of dead ends.
   */
  const epics = useMemo(() => {
    const seen = new Map<number, { id: number; label: string }>();
    for (const item of session.queue) {
      if (item.epic_task_id == null || seen.has(item.epic_task_id)) continue;
      seen.set(item.epic_task_id, {
        id: item.epic_task_id,
        label: item.epic_title?.trim() || item.epic_key || `#${item.epic_task_id}`,
      });
    }
    return [...seen.values()];
  }, [session.queue]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return session.queue.filter((item) => {
      if (epic && String(item.epic_task_id ?? "") !== epic) return false;
      if (proposedOnly && !isProposed(item)) return false;
      if (status === "pending" && item.round_status !== "voting") return false;
      if (status === "revealed" && item.round_status !== "revealed") return false;
      if (status === "applied" && item.round_status !== "applied") return false;
      if (!needle) return true;
      return [item.task_key, item.task_title, item.task_description]
        .some((field) => field?.toLowerCase().includes(needle));
    });
  }, [session.queue, status, epic, proposedOnly, search]);

  const filtering =
    status !== "all" || epic !== "" || proposedOnly || search.trim() !== "";

  /**
   * Dragging a *filtered* list is a lie: the row you drop onto has hidden
   * neighbours, so "after this one" means something different to the server
   * than it looks like on screen. Rather than silently resolving against rows
   * you can't see, drag switches off and the per-row "to top" button — which is
   * unambiguous under any filter — carries the interaction.
   */
  const canDrag = isHost && wide && !filtering && !busy;

  const sensors = useSensors(
    // 6px before a drag starts, so a plain click still behaves like a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byId = new Map(session.queue.map((q) => [q.task_id, q]));
  const label = (taskId: number) =>
    byId.get(taskId)?.task_key ?? `#${taskId}`;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const taskId = Number(active.id);
    const overId = Number(over.id);
    const order = session.queue.map((q) => q.task_id);
    const from = order.indexOf(taskId);
    const to = order.indexOf(overId);
    if (from === -1 || to === -1) return;

    // Direction matters, same as the board: dropping DOWN onto a neighbour has
    // to land after it, or the move is a no-op — "take its place" is where the
    // row already was.
    const rest = order.filter((id) => id !== taskId);
    const at = rest.indexOf(overId);
    const afterTaskId = to > from ? overId : at > 0 ? rest[at - 1] : null;
    onMove(taskId, afterTaskId);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${label(Number(active.id))}.`,
    onDragOver: ({ over }) => (over ? `Over ${label(Number(over.id))}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over
        ? `Moved ${label(Number(active.id))}. It is now near ${label(Number(over.id))}.`
        : `Returned ${label(Number(active.id))} to its place.`,
    onDragCancel: ({ active }) => `Cancelled. ${label(Number(active.id))} stayed put.`,
  };

  if (!session.queue.length) return null;

  const rows = filtered.map((item) => (
    <QueueRow
      key={item.task_id}
      item={item}
      draggable={canDrag}
      active={item.task_id === session.active_task_id}
      // Redundant once the list is already narrowed to one epic.
      showEpic={epic === ""}
      // Nothing to select on a task that's already estimated — it would need a
      // re-vote first — or on the one already on the table.
      canSelect={
        isHost &&
        !busy &&
        item.round_status !== "applied" &&
        item.task_id !== session.active_task_id
      }
      onSelect={() => onSelect(item.task_id)}
    />
  ));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">
          Queue
        </h3>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {filtering ? `${filtered.length}/${session.queue.length}` : session.queue.length}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by key or title"
              className="h-8 w-52 pr-7 pl-7 text-xs"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
                <span className="sr-only">Clear the filter</span>
              </button>
            ) : null}
          </div>

          {/* Hidden entirely when the queue is flat — a one-option epic filter
              is a control that can only ever do nothing. */}
          {epics.length > 1 ? (
            <Select value={epic || "all"} onValueChange={(v) => setEpic(v === "all" ? "" : v)}>
              <SelectTrigger size="sm" className="w-48 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any epic</SelectItem>
                {epics.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger size="sm" className="w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="revealed">Revealed</SelectItem>
              <SelectItem value="applied">Estimated</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="xs"
            variant={proposedOnly ? "secondary" : "outline"}
            aria-pressed={proposedOnly}
            onClick={() => setProposedOnly((v) => !v)}
          >
            <Sparkles className="size-3.5" />
            AI proposed
          </Button>
        </div>
      </div>

      {isHost && filtering ? (
        // Says why the grips vanished, rather than leaving it to be discovered.
        <p className="mb-2 text-xs text-muted-foreground">
          Reordering is off while the queue is filtered — the rows between two
          results are hidden, so a drop position would be ambiguous. Estimate
          this still works: it puts a task on the table regardless of order.
        </p>
      ) : null}

      {!filtered.length ? (
        <div className="rounded-lg border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
          Nothing in the queue matches those filters.
        </div>
      ) : canDrag ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          accessibility={{ announcements }}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={filtered.map((q) => q.task_id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y rounded-lg border bg-card">{rows}</div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="divide-y rounded-lg border bg-card">{rows}</div>
      )}
    </div>
  );
}

function QueueRow({
  item,
  draggable,
  active,
  showEpic,
  canSelect,
  onSelect,
}: {
  item: PokerQueueItem;
  draggable: boolean;
  /** The task currently on the table. */
  active: boolean;
  showEpic: boolean;
  canSelect: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.task_id, disabled: !draggable });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm",
        // The row the deck above is voting on. A left border rather than a fill:
        // it has to survive next to the status colours already in the row.
        active && "border-l-2 border-l-primary bg-primary/5",
        isDragging && "opacity-40",
      )}
    >
      {draggable ? (
        // Grip-only activator, like the board's cards: a row-wide one would
        // swallow the buttons sitting in the same row.
        <button
          type="button"
          className="cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
          <span className="sr-only">Reorder {item.task_key ?? `#${item.task_id}`}</span>
        </button>
      ) : null}

      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
        {item.task_key}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.task_title}</span>
        {/* One secondary line, not two: the epic prefixes the description rather
            than claiming a row of its own. */}
        {showEpic && item.epic_key ? (
          <span className="block truncate text-xs text-muted-foreground">
            <span className="font-mono">{item.epic_key}</span>
            {item.task_description ? ` · ${item.task_description}` : null}
          </span>
        ) : item.task_description ? (
          <span className="block truncate text-xs text-muted-foreground">
            {item.task_description}
          </span>
        ) : null}
      </span>

      {active ? (
        <Badge className="shrink-0 text-[10px]">On the table</Badge>
      ) : canSelect ? (
        <Button size="xs" variant="outline" className="shrink-0" onClick={onSelect}>
          <Play className="size-3" />
          Estimate this
        </Button>
      ) : null}

      {item.attempts > 1 ? (
        <Badge variant="outline" className="text-[10px]">
          {item.attempts} rounds
        </Badge>
      ) : null}
      {isProposed(item) ? (
        <Badge variant="secondary" className="text-[10px]">
          AI proposed
        </Badge>
      ) : null}
      {item.round_status === "applied" ? (
        <span className="font-mono text-xs tabular-nums text-success">
          {formatPoints(item.story_points)} pts
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {item.round_status === "revealed" ? "revealed" : "pending"}
        </span>
      )}
    </div>
  );
}
