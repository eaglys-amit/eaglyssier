import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BacklogSprintBucket, SprintCreateIn } from "@/types/api";

/**
 * Create or edit a local sprint. Native date inputs, FormData on submit — the
 * same shape as the other create dialogs in the app.
 */
export function SprintDialog({
  open,
  onOpenChange,
  sprint,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing when present, creating when not. Only local sprints get here. */
  sprint?: BacklogSprintBucket | null;
  busy: boolean;
  onSubmit: (body: SprintCreateIn) => void;
}) {
  const editing = Boolean(sprint);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${sprint!.name}` : "New sprint"}</DialogTitle>
        </DialogHeader>

        <form
          key={sprint?.sprint_id ?? "new"}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const str = (name: string) => String(fd.get(name) ?? "").trim() || null;
            onSubmit({
              name: String(fd.get("name") ?? "").trim(),
              goal: str("goal"),
              start_date: str("start_date"),
              end_date: str("end_date"),
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              defaultValue={sprint?.name ?? ""}
              placeholder="Sprint 24"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="start_date" className="text-xs text-muted-foreground">
                Starts
              </Label>
              <Input
                id="start_date"
                name="start_date"
                type="date"
                defaultValue={sprint?.start_date ?? ""}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="end_date" className="text-xs text-muted-foreground">
                Ends
              </Label>
              <Input
                id="end_date"
                name="end_date"
                type="date"
                defaultValue={sprint?.end_date ?? ""}
              />
            </div>
          </div>

          {/* Dates drive the capacity working-days calculation and the burndown
              axis, so they're worth setting even though both are optional. */}
          <p className="text-xs text-muted-foreground">
            Dates are optional, but capacity and the burndown are both measured
            against them.
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor="goal" className="text-xs text-muted-foreground">
              Goal
            </Label>
            <Textarea
              id="goal"
              name="goal"
              rows={2}
              defaultValue={sprint?.goal ?? ""}
              placeholder="One sentence on what this sprint is for."
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Create sprint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
