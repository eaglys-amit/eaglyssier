import { RotateCcw, Sparkles, Tag } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useEpicNaming } from "./useEpicGeneration";

/**
 * Rename generated epics — and with them the milestones built from those epics.
 *
 * `PBR 9` is a tracker reference, not a name: it says where the work came from
 * and nothing about what it is. This proposes a real name per group from its
 * task titles, and every one stays an editable text field, because a suggestion
 * is only ever a starting point.
 *
 * Grouping is untouched here. The model sees titles and returns labels; which
 * task belongs where was already decided deterministically.
 */
export function NameEpicsDialog({
  projectId,
  trigger,
}: {
  projectId: number;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { nameable, suggest, rename } = useEpicNaming(projectId, open);

  // Only groups with an epic already on the board can be renamed; the rest are
  // named when they're generated.
  const groups = useMemo(
    () => (nameable.data?.groups ?? []).filter((g) => g.existing_task_id !== null),
    [nameable.data],
  );

  useEffect(() => {
    if (!open) {
      setDraft({});
      suggest.reset();
    }
  }, [open, suggest]);

  const current = (key: string, fallback: string) => draft[key] ?? fallback;
  const changed = groups.filter(
    (g) => current(g.group_key, g.current_name).trim() !== g.current_name,
  );

  const runSuggest = async () => {
    const result = await suggest.mutateAsync();
    setDraft((prev) => ({ ...result.names, ...prev }));
  };

  const apply = async () => {
    const names: Record<string, string> = {};
    for (const g of changed) names[g.group_key] = current(g.group_key, g.current_name).trim();
    await rename.mutateAsync(names);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Name epics</DialogTitle>
          <DialogDescription>
            These names flow straight through to the milestones generated from them.
            Suggestions come from the task titles in each group — edit any of them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-6 py-2">
          <span className="text-xs text-muted-foreground">
            {groups.length} {groups.length === 1 ? "epic" : "epics"}
            {changed.length ? ` · ${changed.length} edited` : ""}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={!groups.length || suggest.isPending}
            onClick={runSuggest}
          >
            <Sparkles className="size-3.5" />
            {suggest.isPending ? "Thinking…" : "Suggest names"}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {nameable.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : !groups.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No generated epics to rename yet. Generate them first, and you can name
              them in that dialog.
            </p>
          ) : (
            <div className="space-y-1.5">
              {groups.map((g) => {
                const value = current(g.group_key, g.current_name);
                const isChanged = value.trim() !== g.current_name;
                return (
                  <div key={g.group_key} className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className="w-16 shrink-0 justify-center font-mono text-[10px]"
                    >
                      {g.group_key}
                    </Badge>
                    <Input
                      value={value}
                      className="h-8"
                      aria-label={`Name for ${g.group_key}`}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, [g.group_key]: e.target.value }))
                      }
                    />
                    <span className="w-14 shrink-0 text-right text-[10px] text-muted-foreground">
                      {g.member_count} {g.member_count === 1 ? "task" : "tasks"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!isChanged}
                      title="Revert to the current name"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, [g.group_key]: g.current_name }))
                      }
                    >
                      <RotateCcw className="size-3.5" />
                      <span className="sr-only">Revert {g.group_key}</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center justify-between gap-3 border-t px-6 py-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {changed.length
              ? `${changed.length} ${changed.length === 1 ? "name" : "names"} will change`
              : "Nothing edited"}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!changed.length || rename.isPending} onClick={apply}>
              {rename.isPending ? "Saving…" : `Rename ${changed.length || ""}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The button, so callers don't repeat the icon and label. */
export function NameEpicsButton({ projectId }: { projectId: number }) {
  return (
    <NameEpicsDialog
      projectId={projectId}
      trigger={
        <Button size="sm" variant="outline">
          <Tag className="size-4" />
          Name epics
        </Button>
      }
    />
  );
}
