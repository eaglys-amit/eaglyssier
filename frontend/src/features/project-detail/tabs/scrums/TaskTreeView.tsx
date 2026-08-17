import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, GitBranch, GripVertical, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPoints, taskLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Milestone, TaskNode } from "@/types/api";

/** Sentinel: a Radix Select value can't be null or an empty string. */
const NO_MILESTONE = "none";

/**
 * The board's hierarchy view.
 *
 * The flat list is the planning surface — it's what drag, rank and move-to-sprint
 * act on — but it renders an epic as a peer of its own children, so a breakdown's
 * structure disappears the moment its tasks are created. This view is the other
 * half: parents contain their children, and a container shows the points rolled
 * up from its leaves rather than the nothing it carries itself.
 */
export function TaskTreeView({
  nodes,
  depth = 0,
  draggable = false,
  milestones,
  onEdit,
  onDelete,
  onSetMilestone,
}: {
  nodes: TaskNode[];
  depth?: number;
  /** Wired by the owner, which also hosts the DndContext this reports into. */
  draggable?: boolean;
  /** Omitted = no milestone control; the tree is usable without one. */
  milestones?: Milestone[];
  onEdit: (task: TaskNode) => void;
  onDelete: (task: TaskNode, cascade: boolean) => void;
  onSetMilestone?: (task: TaskNode, milestoneId: number | null) => void;
}) {
  if (!nodes.length) return null;
  return (
    <div className={cn("space-y-1.5", depth > 0 && "mt-1.5 ml-4 border-l pl-3")}>
      {nodes.map((node) => (
        <TaskTreeNode
          key={node.id}
          node={node}
          depth={depth}
          draggable={draggable}
          milestones={milestones}
          onEdit={onEdit}
          onDelete={onDelete}
          onSetMilestone={onSetMilestone}
        />
      ))}
    </div>
  );
}

function TaskTreeNode({
  node,
  depth,
  draggable,
  milestones,
  onEdit,
  onDelete,
  onSetMilestone,
}: {
  node: TaskNode;
  depth: number;
  draggable: boolean;
  milestones?: Milestone[];
  onEdit: (task: TaskNode) => void;
  onDelete: (task: TaskNode, cascade: boolean) => void;
  onSetMilestone?: (task: TaskNode, milestoneId: number | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [, setParams] = useSearchParams();
  const isContainer = node.children.length > 0;

  // Draggable and droppable at once: every row can be picked up, and every row
  // can receive — dropping onto a leaf is how a leaf becomes a parent. The
  // owner rejects a drop into the dragged row's own subtree.
  const drag = useDraggable({ id: node.id, disabled: !draggable });
  const drop = useDroppable({ id: node.id, disabled: !draggable });
  const isTarget = drop.isOver && drag.active?.id !== node.id;

  const openSheet = () =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("task", String(node.id));
      return next;
    });

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      ref={drop.setNodeRef}
      className={cn(
        "rounded-lg border bg-card",
        // The row the cursor would drop into. A ring rather than a fill: the row
        // already carries status colours that a background would fight.
        isTarget && "ring-2 ring-primary ring-offset-1",
        drag.isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        {draggable ? (
          // Grip-only activator, as on the board's cards: a row-wide one would
          // swallow the title link and the buttons beside it.
          <button
            type="button"
            ref={drag.setNodeRef}
            className="mt-0.5 shrink-0 cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
            {...drag.attributes}
            {...drag.listeners}
          >
            <GripVertical className="size-4" />
            <span className="sr-only">Move {taskLabel(node)} to another epic</span>
          </button>
        ) : null}

        {isContainer ? (
          <CollapsibleTrigger className="group mt-0.5 shrink-0" aria-label="Toggle subtasks">
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
          </CollapsibleTrigger>
        ) : (
          <span className="mt-0.5 w-4 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="truncate text-left text-sm font-medium hover:underline"
              onClick={openSheet}
            >
              {node.title}
            </button>
            {node.source === "local" ? (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                Local
              </Badge>
            ) : null}
          </div>

          {node.description_preview ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {node.description_preview}
            </p>
          ) : null}

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{taskLabel(node)}</span>
            {node.issue_type ? (
              <Badge variant="secondary" className="text-[10px] uppercase">
                {node.issue_type}
              </Badge>
            ) : null}
            {taskCategoryBadge(node.status_category, node.status)}
            {isContainer ? (
              // A container carries no points of its own — showing "—" would
              // read as unestimated when the work below it is fully estimated.
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3" />
                <span className="font-mono tabular-nums">
                  {formatPoints(node.rollup_points)} pts
                </span>
                <span>
                  in {node.children.length} {node.children.length === 1 ? "item" : "items"}
                </span>
              </span>
            ) : node.story_points != null ? (
              <span className="font-mono tabular-nums">
                {formatPoints(node.story_points)} pts
              </span>
            ) : (
              <span className="italic">no estimate</span>
            )}
            {node.assignee_name ? <span className="truncate">{node.assignee_name}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* Top level only. Linking cascades to the subtree server-side, so
              offering it on a child too would be two controls fighting over the
              same rows. */}
          {milestones?.length && onSetMilestone && depth === 0 ? (
            <Select
              value={node.milestone_id == null ? NO_MILESTONE : String(node.milestone_id)}
              onValueChange={(v) =>
                onSetMilestone(node, v === NO_MILESTONE ? null : Number(v))
              }
            >
              <SelectTrigger size="sm" className="mr-1 h-7 w-36 text-xs">
                <SelectValue placeholder="No milestone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MILESTONE}>No milestone</SelectItem>
                {milestones.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(node)}>
            <Pencil className="size-3.5" />
            <span className="sr-only">Edit {taskLabel(node)}</span>
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                <Trash2 className="size-3.5" />
                <span className="sr-only">Delete {taskLabel(node)}</span>
              </Button>
            }
            title={`Delete ${taskLabel(node)}?`}
            description={
              isContainer
                ? `Its ${node.children.length} subtask(s) are kept and move up to the top level.`
                : node.source === "local"
                  ? "This task was created here, so no sync can bring it back."
                  : "A Jira re-sync will recreate this task."
            }
            onConfirm={() => onDelete(node, false)}
          />
        </div>
      </div>

      {isContainer ? (
        <CollapsibleContent>
          <div className="px-2.5 pb-2">
            <TaskTreeView
              nodes={node.children}
              depth={depth + 1}
              draggable={draggable}
              milestones={milestones}
              onEdit={onEdit}
              onDelete={onDelete}
              onSetMilestone={onSetMilestone}
            />
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
