import { AlertTriangle, ChevronDown, ChevronRight, Layers, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import type { EpicMemberRef, EpicProposal } from "@/types/api";

import { useEpicGeneration, useEpicNaming } from "./useEpicGeneration";

/**
 * Rebuild the backlog tree from the numbering already in the task titles.
 *
 * Jira here carries no epics, so everything downstream that wants a hierarchy
 * sees a flat list. But the titles are not flat — `PBR9-PBI2-ST1: …` states the
 * hierarchy explicitly. This reads that, rather than asking a model to guess at
 * the same text.
 *
 * Coverage is stated on the face of the dialog and every unplaceable task is
 * listed by name. A generator that quietly handles most of a backlog is
 * indistinguishable from a broken one — which is exactly the complaint that
 * produced this screen.
 */
export function GenerateEpicsDialog({
  projectId,
  trigger,
}: {
  projectId: number;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const { preview, generate } = useEpicGeneration(projectId, open);
  const { suggest } = useEpicNaming(projectId, open);

  const data = preview.data;
  const proposals = data?.proposals ?? [];

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setNames({});
      return;
    }
    if (data && picked === null) {
      setPicked(
        new Set(
          data.proposals.filter((p) => p.conflict === null).map((p) => p.group_key),
        ),
      );
    }
  }, [open, data, picked]);

  const selected = picked ?? new Set<string>();
  const chosen = proposals.filter(
    (p) => p.conflict === null && selected.has(p.group_key),
  );
  const memberTotal = chosen.reduce((n, p) => n + p.member_count, 0);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const runSuggest = async () => {
    const result = await suggest.mutateAsync();
    // The user's own edits win over a suggestion arriving after them.
    setNames((prev) => ({ ...result.names, ...prev }));
  };

  const apply = async () => {
    await generate.mutateAsync({
      groupKeys: chosen.map((p) => p.group_key),
      names,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* flex flex-col overrides DialogContent's `grid`: without it the body's
          flex-1/min-h-0 do nothing, the content runs past max-h, and
          overflow-hidden clips the footer buttons off-screen. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Generate epics from task numbering</DialogTitle>
          <DialogDescription>
            Your tasks are already numbered <span className="font-mono">PBR9-PBI2-ST1</span>.
            This groups them by that number into epics, moving the real tasks — not copies.
            Sync won&rsquo;t undo it, and each epic can be ungrouped from the board.
          </DialogDescription>
        </DialogHeader>

        {data ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-6 py-2 text-xs">
            <span>
              <span className="font-mono font-semibold tabular-nums">
                {data.coverage_pct}%
              </span>{" "}
              coverage
            </span>
            <span className="text-muted-foreground">
              {data.total_member_count} of {data.needs_group_count} ungrouped tasks placed
            </span>
            {data.ungrouped.length ? (
              <span className="text-warning">
                {data.ungrouped.length} can&rsquo;t be placed — listed at the bottom
              </span>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              disabled={!proposals.length || suggest.isPending}
              onClick={runSuggest}
            >
              <Sparkles className="size-3.5" />
              {suggest.isPending ? "Thinking…" : "Suggest names"}
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {preview.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !proposals.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No task titles carry a PBR or PBI number, so there is nothing to group on.
              Epics can still be built by hand on the Scrums board.
            </p>
          ) : (
            <div className="space-y-2">
              {proposals.map((p) => (
                <EpicRow
                  key={p.group_key}
                  proposal={p}
                  checked={selected.has(p.group_key)}
                  onToggle={() => toggle(p.group_key)}
                  name={names[p.group_key] ?? p.name}
                  onRename={(v) =>
                    setNames((prev) => ({ ...prev, [p.group_key]: v }))
                  }
                />
              ))}

              {data?.ungrouped.length ? (
                <div className="mt-4 rounded-lg border border-dashed">
                  <div className="flex items-center gap-2 border-b px-3 py-2">
                    <AlertTriangle className="size-3.5 text-warning" />
                    <span className="text-xs font-medium">
                      {data.ungrouped.length} tasks with no PBR/PBI number
                    </span>
                    <span className="text-xs text-muted-foreground">
                      — left where they are; group them by hand on the board
                    </span>
                  </div>
                  <ul className="divide-y text-xs">
                    {data.ungrouped.map((t) => (
                      <li key={t.task_id} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="w-24 shrink-0 font-mono text-[10px] text-muted-foreground">
                          {t.key}
                        </span>
                        <span className="truncate">{t.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {t.sprint_name ?? "backlog"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center justify-between gap-3 border-t px-6 py-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {chosen.length
              ? `${chosen.length} epics · ${memberTotal} tasks re-parented`
              : "Nothing selected"}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!chosen.length || generate.isPending} onClick={apply}>
              {generate.isPending ? "Generating…" : `Generate ${chosen.length || ""}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EpicRow({
  proposal: p,
  checked,
  onToggle,
  name,
  onRename,
}: {
  proposal: EpicProposal;
  checked: boolean;
  onToggle: () => void;
  name: string;
  onRename: (value: string) => void;
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
            {/* Editable: the epic's name becomes the milestone's name, and a
                derived label is only ever a starting point. */}
            <Input
              value={name}
              disabled={blocked}
              className="h-7 flex-1 text-sm font-medium"
              aria-label={`Name for ${p.group_key}`}
              onChange={(e) => onRename(e.target.value)}
            />
            <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
              {p.group_key}
            </Badge>
            {p.mode === "top_up" && !blocked ? (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                tops up an existing epic
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>
              {p.member_count} {p.member_count === 1 ? "task" : "tasks"} ·{" "}
              {formatPoints(p.total_points)} pts
            </span>
            {p.start_date ? (
              <>
                <span>·</span>
                <span>
                  {formatDate(p.start_date)} → {formatDate(p.end_date)}
                </span>
              </>
            ) : null}
            {p.sprint_names.length ? (
              <>
                <span>·</span>
                <span>
                  {p.sprint_names.length}{" "}
                  {p.sprint_names.length === 1 ? "sprint" : "sprints"}
                </span>
              </>
            ) : null}
            {p.skip_count ? (
              <>
                <span>·</span>
                <span className="text-warning">{p.skip_count} skipped</span>
              </>
            ) : null}
          </div>
          {blocked ? (
            <p className="mt-1 text-xs text-warning">{p.conflict}</p>
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
            {expanded ? "Hide" : "Show"} the tasks in {p.name}
          </span>
        </Button>
      </div>

      {expanded ? (
        <ul className="divide-y border-t text-xs">
          {p.members.map((m) => (
            <MemberRow key={m.task_id} member={m} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MemberRow({ member: m }: { member: EpicMemberRef }) {
  return (
    <li className="flex items-center gap-2 px-3 py-1.5">
      <span className="w-24 shrink-0 font-mono text-[10px] text-muted-foreground">
        {m.key}
      </span>
      <span className="truncate">{m.title}</span>
      <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {m.story_points === null ? "—" : formatPoints(m.story_points)}
      </span>
      <span className="w-32 shrink-0 truncate text-right text-[10px] text-muted-foreground">
        {m.sprint_name ?? "backlog"}
      </span>
      <span
        className={cn(
          "w-16 shrink-0 text-right text-[10px]",
          m.action === "group" ? "text-muted-foreground" : "text-warning",
        )}
        title={m.reason ?? undefined}
      >
        {m.action === "group" ? "group" : "skip"}
      </span>
    </li>
  );
}

/** The button, so callers don't repeat the icon and label. */
export function GenerateEpicsButton({
  projectId,
  variant = "outline",
}: {
  projectId: number;
  variant?: "outline" | "default";
}) {
  return (
    <GenerateEpicsDialog
      projectId={projectId}
      trigger={
        <Button size="sm" variant={variant}>
          <Layers className="size-4" />
          Generate epics
        </Button>
      }
    />
  );
}
