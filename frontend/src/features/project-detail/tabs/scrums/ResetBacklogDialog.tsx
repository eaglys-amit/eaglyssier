import { RotateCcw } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Empty the backlog so a Jira sync can refill it.
 *
 * Not a ConfirmDialog: the choice this has to offer is the whole point, and a
 * checkbox can't live inside that component's description paragraph. Two very
 * different actions sit behind one button, so the dialog says what each will
 * remove in actual numbers rather than in the abstract.
 *
 * The dangerous half is opt-in per press — the box resets every time the dialog
 * opens, because "delete work nothing can rebuild" should never be a state the
 * next click inherits.
 */
export function ResetBacklogDialog({
  syncedCount,
  localCount,
  aiCount,
  busy,
  onConfirm,
}: {
  /** Backlog tasks a re-sync would bring back. */
  syncedCount: number;
  /** Backlog tasks created here — hand-made or AI-generated. */
  localCount: number;
  /** How many of `localCount` came from a breakdown, for the warning. */
  aiCount: number;
  busy: boolean;
  onConfirm: (options: { includeLocal: boolean; count: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [includeLocal, setIncludeLocal] = useState(false);

  const count = includeLocal ? syncedCount + localCount : syncedCount;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Never carry the destructive choice into the next press.
        if (!next) setIncludeLocal(false);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={busy || syncedCount + localCount === 0}
          title="Empty the backlog, then sync Jira to pull it fresh"
        >
          <RotateCcw className="size-3.5" /> Reset
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset the backlog?</AlertDialogTitle>
          <AlertDialogDescription>
            {syncedCount
              ? `Removes the ${syncedCount} synced ${syncedCount === 1 ? "task" : "tasks"} with no sprint. Sync Jira afterwards to pull them fresh.`
              : "Nothing in the backlog came from Jira, so there is nothing a sync could pull back."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {localCount ? (
          <label className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <Checkbox
              checked={includeLocal}
              onCheckedChange={(v) => setIncludeLocal(v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                Also delete the {localCount} {localCount === 1 ? "task" : "tasks"} created
                here
                {aiCount ? ` (${aiCount} AI-generated)` : ""}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                No sync can rebuild these. Their poker estimates go with them, and any
                sprint work they parent is promoted to top level.
              </span>
            </span>
          </label>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
            disabled={count === 0}
            onClick={() => onConfirm({ includeLocal, count })}
          >
            {/* The number is in the button because that's what the click does —
                the checkbox above changes it as you tick. */}
            Remove {count} {count === 1 ? "task" : "tasks"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
