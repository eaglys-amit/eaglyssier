import { useEffect, useState, type ReactNode } from "react";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Milestone, MilestoneCreateIn, MilestoneState } from "@/types/api";

const STATES: { value: MilestoneState; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "released", label: "Released" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Create or edit a milestone. Dates only — scope is set by linking tasks in the
 * detail sheet, never typed in here, because every number on the roadmap is
 * rolled up from those tasks.
 */
export function MilestoneDialog({
  trigger,
  milestone,
  pending,
  onSubmit,
}: {
  trigger: ReactNode;
  /** Omit to create. */
  milestone?: Milestone;
  pending?: boolean;
  onSubmit: (values: MilestoneCreateIn) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [state, setState] = useState<MilestoneState>("planned");

  // Reset from props each time it opens, so a cancelled edit doesn't leak into
  // the next one.
  useEffect(() => {
    if (!open) return;
    setName(milestone?.name ?? "");
    setDescription(milestone?.description ?? "");
    setStartDate(milestone?.start_date ?? "");
    setTargetDate(milestone?.target_date ?? "");
    setState(milestone?.state ?? "planned");
  }, [open, milestone]);

  const invalidRange = Boolean(startDate && targetDate && targetDate < startDate);
  const canSubmit = name.trim().length > 0 && !invalidRange && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    await onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      start_date: startDate || null,
      target_date: targetDate || null,
      state,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{milestone ? "Edit milestone" : "New milestone"}</DialogTitle>
          <DialogDescription>
            Progress and the completion forecast are rolled up from the tasks you link to
            it — there is nothing to keep up to date here but the dates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="milestone-name">Name</Label>
            <Input
              id="milestone-name"
              value={name}
              autoFocus
              placeholder="v1.1 GA"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="milestone-start">Start</Label>
              <Input
                id="milestone-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="milestone-target">Target</Label>
              <Input
                id="milestone-target"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>
          {invalidRange ? (
            <p className="text-xs text-destructive">
              The target date can&rsquo;t fall before the start date.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="milestone-state">State</Label>
            <Select value={state} onValueChange={(v) => setState(v as MilestoneState)}>
              <SelectTrigger id="milestone-state" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="milestone-description">Description</Label>
            <Textarea
              id="milestone-description"
              rows={3}
              value={description}
              placeholder="What has to be true for this to ship?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={submit}>
            {pending ? "Saving…" : milestone ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
