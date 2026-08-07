import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A column that accepts a drop anywhere in it, not just onto a card.
 *
 * Without this, an empty list would be un-droppable (a SortableContext with no
 * items registers no drop targets) and the gap below the last card would reject
 * a drop that visually looks fine.
 */
export function DropColumn({
  id,
  empty,
  children,
}: {
  id: string;
  /** Empty columns need a visible target, so they get a dashed frame while dragging. */
  empty: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id });
  const dragging = active != null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Fills the panel so the whole column is a target, not just the cards.
        "min-h-24 rounded-lg transition-colors",
        empty && dragging && "border-2 border-dashed",
        isOver && (empty ? "border-primary bg-primary/5" : "bg-primary/5"),
      )}
    >
      {children}
    </div>
  );
}
