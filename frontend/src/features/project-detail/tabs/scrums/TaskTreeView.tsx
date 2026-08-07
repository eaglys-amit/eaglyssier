import { ChevronDown, GitBranch, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatPoints, taskLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskNode } from "@/types/api";

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
  onEdit,
  onDelete,
}: {
  nodes: TaskNode[];
  depth?: number;
  onEdit: (task: TaskNode) => void;
  onDelete: (task: TaskNode, cascade: boolean) => void;
}) {
  if (!nodes.length) return null;
  return (
    <div className={cn("space-y-1.5", depth > 0 && "mt-1.5 ml-4 border-l pl-3")}>
      {nodes.map((node) => (
        <TaskTreeNode
          key={node.id}
          node={node}
          depth={depth}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function TaskTreeNode({
  node,
  depth,
  onEdit,
  onDelete,
}: {
  node: TaskNode;
  depth: number;
  onEdit: (task: TaskNode) => void;
  onDelete: (task: TaskNode, cascade: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [, setParams] = useSearchParams();
  const isContainer = node.children.length > 0;

  const openSheet = () =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("task", String(node.id));
      return next;
    });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <div className="flex items-start gap-2 px-2.5 py-2">
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
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
