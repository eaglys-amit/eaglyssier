import { Copy, Download, Inbox } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copyText, downloadText, slugify } from "@/lib/download";
import { formatPoints } from "@/lib/format";
import type { PokerQueueItem, PokerSessionDetail } from "@/types/api";

import { toEstimatesMarkdown } from "./estimates-markdown";
import { useBoard } from "./useBoard";

/**
 * What the room has agreed — the other half of the session's list, and the
 * counterpart to PokerQueue above it.
 *
 * The two partition the session: the Queue is what still needs a number, this is
 * what has one. Nothing here is actionable, so there's no drag and no per-row
 * button; the interesting part is the record, which is why this is the section
 * that exports.
 *
 * Session-scoped, not sprint-scoped. The board already lists a sprint's points —
 * what only this knows is how many rounds each number took to agree, and that it
 * came from a vote rather than from a model.
 */
export function EstimatedTasks({
  projectId,
  session,
}: {
  projectId: number;
  session: PokerSessionDetail;
}) {
  // Reused for the write and its invalidation sweep, the way EpicsView takes it
  // for the same reason: the board is the surface this button's result shows up
  // on, so its data layer is what has to know the move happened.
  const { saveToBacklog } = useBoard(projectId);

  const applied = useMemo(
    // Queue order — the server ranks the rounds, so this reads in the order the
    // room worked through them.
    () => session.queue.filter((q) => q.round_status === "applied"),
    [session.queue],
  );

  const total = useMemo(
    () => applied.reduce((sum, item) => sum + (item.story_points ?? 0), 0),
    [applied],
  );

  // Nothing agreed yet. The header's "0/12 estimated" already says so, so an
  // empty panel here would only repeat it.
  if (!applied.length) return null;

  const markdown = () => toEstimatesMarkdown(session, applied);

  /**
   * Put the agreed work where it can be planned.
   *
   * Every row goes over, including tasks already sitting in the backlog: the
   * move re-ranks them, so what the room just estimated arrives as one block
   * instead of scattered among whatever was there before. That also means the
   * button always has a visible result, which a skip-what's-already-there
   * version wouldn't.
   */
  const onSave = () => saveToBacklog.mutate(applied.map((item) => item.task_id));

  const onCopy = async () => {
    if (await copyText(markdown())) {
      toast.success(`Copied ${applied.length} estimates as markdown`);
    } else {
      toast.error("Could not reach the clipboard — use Download instead");
    }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">
          Estimated tasks
        </h3>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {applied.length}
        </span>
        <span className="font-mono text-xs tabular-nums text-success">
          {formatPoints(total)} pts
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={saveToBacklog.isPending}
            title="Move these to the board's backlog, ready to plan into a sprint"
            onClick={onSave}
          >
            <Inbox className="size-3.5" />
            {saveToBacklog.isPending ? "Saving…" : "Save To Backlog"}
          </Button>
          <Button size="xs" variant="outline" onClick={onCopy}>
            <Copy className="size-3.5" />
            Copy
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              downloadText(`${slugify(session.name)}-estimates.md`, markdown())
            }
          >
            <Download className="size-3.5" />
            Markdown
          </Button>
        </div>
      </div>

      <div className="divide-y rounded-lg border bg-card">
        {applied.map((item) => (
          <EstimatedRow key={item.task_id} item={item} />
        ))}
      </div>
    </div>
  );
}

/** Deliberately shaped like PokerQueue's QueueRow, so the two lists read as one. */
function EstimatedRow({ item }: { item: PokerQueueItem }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
        {item.task_key}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.task_title}</span>
        {/* One secondary line, not two: the epic prefixes the description rather
            than claiming a row of its own. */}
        {item.epic_key ? (
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

      {/* How long the room argued about it — the one thing this list knows that
          the board's copy of the same points doesn't. */}
      {item.attempts > 1 ? (
        <Badge variant="outline" className="text-[10px]">
          {item.attempts} rounds
        </Badge>
      ) : null}
      <span className="font-mono text-xs tabular-nums text-success">
        {formatPoints(item.story_points)} pts
      </span>
    </div>
  );
}
