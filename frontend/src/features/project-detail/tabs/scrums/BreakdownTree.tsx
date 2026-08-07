import { AlertTriangle, ChevronDown, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import type { Deck } from "@/types/api";

import type { DraftNode } from "./breakdown-draft";

const NONE = "none";

/** The drafted tree, editable in place before anything is created. */
export function BreakdownTree({
  nodes,
  deck,
  depth = 0,
  onToggle,
  onEdit,
  onRemove,
}: {
  nodes: DraftNode[];
  deck: Deck | undefined;
  depth?: number;
  onToggle: (id: string, accepted: boolean) => void;
  onEdit: (id: string, patch: Partial<DraftNode>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className={cn("space-y-1.5", depth > 0 && "mt-1.5 ml-6 border-l pl-3")}>
      {nodes.map((node) => (
        <BreakdownNodeRow
          key={node.id}
          node={node}
          deck={deck}
          depth={depth}
          onToggle={onToggle}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function BreakdownNodeRow({
  node,
  deck,
  depth,
  onToggle,
  onEdit,
  onRemove,
}: {
  node: DraftNode;
  deck: Deck | undefined;
  depth: number;
  onToggle: (id: string, accepted: boolean) => void;
  onEdit: (id: string, patch: Partial<DraftNode>) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const isContainer = node.children.length > 0;
  // The same rule poker enforces: a break-it-down estimate on a childless node.
  const needsBreakdown =
    !isContainer &&
    node.story_points != null &&
    (deck?.needs_breakdown ?? []).includes(node.story_points);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-lg border bg-card", !node.accepted && "opacity-50")}
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        <Checkbox
          checked={node.accepted}
          onCheckedChange={(v) => onToggle(node.id, v === true)}
          className="mt-1.5"
          aria-label={`Create ${node.title}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isContainer ? (
              <CollapsibleTrigger className="group shrink-0" aria-label="Toggle subtasks">
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
              </CollapsibleTrigger>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <Input
              value={node.title}
              onChange={(e) => onEdit(node.id, { title: e.target.value })}
              className="h-8 border-transparent bg-transparent px-1 font-medium shadow-none focus-visible:border-input focus-visible:bg-background"
              aria-label="Title"
            />
          </div>

          <div className="mt-0.5 ml-5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="secondary" className="text-[10px] uppercase">
              {node.level}
            </Badge>
            {isContainer ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatPoints(node.rollup)} pts rolled up
              </span>
            ) : (
              <Select
                value={node.story_points != null ? String(node.story_points) : NONE}
                onValueChange={(v) =>
                  onEdit(node.id, { story_points: v === NONE ? null : Number(v) })
                }
              >
                <SelectTrigger size="sm" className="h-6 w-24 text-xs">
                  <SelectValue placeholder="no est." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No estimate</SelectItem>
                  {(deck?.points ?? []).map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {p} pts
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {needsBreakdown ? (
              <span className="inline-flex items-center gap-1 text-xs text-warning">
                <AlertTriangle className="size-3.5" />
                the scale says to split this
              </span>
            ) : null}
            {node.description ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {node.description}
              </span>
            ) : null}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => onRemove(node.id)}
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Remove {node.title} from the draft</span>
        </Button>
      </div>

      <CollapsibleContent>
        {node.rationale || node.acceptance_criteria ? (
          <div className="ml-9 space-y-1 border-t px-2.5 py-2 text-xs text-muted-foreground">
            {node.rationale ? <p>Why this estimate: {node.rationale}</p> : null}
            {node.acceptance_criteria ? (
              <p className="whitespace-pre-line">{node.acceptance_criteria}</p>
            ) : null}
          </div>
        ) : null}
        {isContainer ? (
          <div className="px-2.5 pb-2">
            <BreakdownTree
              nodes={node.children}
              deck={deck}
              depth={depth + 1}
              onToggle={onToggle}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
