import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GeneratedMilestone } from "@/types/api";

import { GenerateEpicsButton } from "./GenerateEpicsDialog";
import { useGeneratePreview, useMilestones } from "./useMilestones";

/**
 * Generate milestones from the backlog tree, dated by the sprints the work
 * sits in.
 *
 * Preview first, always: this is a bulk write against real planning data, and
 * the preview is computed by the same server function that applies, so it
 * cannot promise something the write then does differently.
 *
 * An "epic" here is structural — a task with no parent that has children —
 * not a task whose issue_type happens to say "Epic", because that field is
 * free text a connector supplies and locally-planned trees never have it.
 */
export function GenerateDialog({
  projectId,
  trigger,
}: {
  projectId: number;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const preview = useGeneratePreview(projectId, open);
  const { generate } = useMilestones(projectId);

  const proposals = preview.data?.proposals ?? [];
  const ready = proposals.filter((p) => p.conflict === null);

  // Default to everything applicable, once the preview lands. Recomputed from
  // preview.data rather than the derived `ready` array, which is a new object
  // every render and would re-fire this forever.
  useEffect(() => {
    if (!open) {
      setPicked(null);
      return;
    }
    if (preview.data && picked === null) {
      setPicked(
        new Set(
          preview.data.proposals
            .filter((p) => p.conflict === null)
            .map((p) => p.source_task_id),
        ),
      );
    }
  }, [open, preview.data, picked]);

  const selected = picked ?? new Set<number>();
  const chosen = ready.filter((p) => selected.has(p.source_task_id));
  const linkTotal = chosen.reduce((n, p) => n + p.link_count, 0);
  const createTotal = chosen.filter((p) => p.mode === "create").length;
  const topUpTotal = chosen.filter((p) => p.mode === "top_up").length;

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    await generate.mutateAsync([...selected]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* flex flex-col overrides DialogContent's `grid`: without it the body's
          flex-1/min-h-0 do nothing and the footer is clipped off-screen. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Generate milestones from sprints</DialogTitle>
          <DialogDescription>
            One milestone per top-level epic, with its dates taken from the sprints its
            tasks sit in. Work already on a milestone is left where it is.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {preview.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : !proposals.length ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="max-w-md text-sm text-muted-foreground">
                Nothing to generate: this project has no epics — no task with subtasks
                under it. If your task titles are numbered (
                <span className="font-mono">PBR9-PBI2-ST1</span>), the epics can be built
                from that first.
              </p>
              <GenerateEpicsButton projectId={projectId} variant="default" />
            </div>
          ) : (
            <div className="space-y-2">
              {proposals.map((p) => (
                <ProposalRow
                  key={p.source_task_id}
                  proposal={p}
                  checked={selected.has(p.source_task_id)}
                  onToggle={() => toggle(p.source_task_id)}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center justify-between gap-3 border-t px-6 py-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {chosen.length ? (
              <>
                {createTotal ? `${createTotal} new` : null}
                {createTotal && topUpTotal ? " · " : null}
                {topUpTotal ? `${topUpTotal} topped up` : null}
                {" · "}
                {linkTotal} {linkTotal === 1 ? "task" : "tasks"} linked
                {preview.data?.total_skip_count
                  ? ` · ${preview.data.total_skip_count} left on other milestones`
                  : null}
              </>
            ) : (
              "Nothing selected"
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!chosen.length || generate.isPending}
              onClick={apply}
            >
              {generate.isPending ? "Generating…" : `Generate ${chosen.length || ""}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProposalRow({
  proposal: p,
  checked,
  onToggle,
}: {
  proposal: GeneratedMilestone;
  checked: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const blocked = p.conflict !== null;

  return (
    <div className={cn("rounded-lg border", blocked && "opacity-60")}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Checkbox
          className="mt-0.5"
          checked={checked && !blocked}
          disabled={blocked}
          onCheckedChange={onToggle}
          aria-label={`Include ${p.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{p.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {p.source_key}
            </span>
            {p.mode === "top_up" && !blocked ? (
              <Badge variant="outline" className="text-[10px]">
                tops up an existing milestone
              </Badge>
            ) : null}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {p.start_date || p.target_date
                ? `${formatDate(p.start_date)} → ${formatDate(p.target_date)}`
                : "no dates — its tasks aren't in a sprint yet"}
            </span>
            <span>·</span>
            <span>
              {p.link_count} {p.link_count === 1 ? "task" : "tasks"} ·{" "}
              {formatPoints(p.total_points)} pts
            </span>
            {p.skip_count ? (
              <>
                <span>·</span>
                <span className="text-warning">{p.skip_count} already linked</span>
              </>
            ) : null}
          </div>

          {p.sprint_names.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {p.sprint_names.map((n) => (
                <Badge key={n} variant="secondary" className="text-[10px]">
                  {n}
                </Badge>
              ))}
            </div>
          ) : null}

          {blocked ? (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {p.conflict}
            </p>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <span className="sr-only">
            {expanded ? "Hide" : "Show"} the tasks under {p.name}
          </span>
        </Button>
      </div>

      {expanded ? (
        <ul className="divide-y border-t text-xs">
          {p.tasks.map((t) => (
            <li key={t.task_id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-10 shrink-0 font-mono text-[10px] text-muted-foreground">
                {t.key}
              </span>
              <span className="truncate">{t.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {t.story_points === null ? "—" : formatPoints(t.story_points)}
              </span>
              <span className="w-32 shrink-0 truncate text-right text-[10px] text-muted-foreground">
                {t.sprint_name ?? "backlog"}
              </span>
              <span
                className={cn(
                  "w-24 shrink-0 text-right text-[10px]",
                  t.action === "link" ? "text-muted-foreground" : "text-warning",
                )}
                title={t.held_by ? `Already on ${t.held_by}` : undefined}
              >
                {t.action === "link" ? "link" : `on ${t.held_by ?? "another"}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The button, so callers don't repeat the icon and label. */
export function GenerateButton({
  projectId,
  variant = "outline",
}: {
  projectId: number;
  variant?: "outline" | "default";
}) {
  return (
    <GenerateDialog
      projectId={projectId}
      trigger={
        <Button size="sm" variant={variant}>
          <Sparkles className="size-4" />
          Generate from sprints
        </Button>
      }
    />
  );
}
