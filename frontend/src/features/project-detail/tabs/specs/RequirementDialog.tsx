import { Check, Link2, Pencil, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { taskLabel } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import type {
  Requirement,
  RequirementKind,
  RequirementPriority,
  SpecDetail,
} from "@/types/api";

import { AcceptanceCriteria } from "./AcceptanceCriteria";
import { changeBadge, requirementStatusBadge } from "./spec-ui";
import { type RequirementDraft, useProjectTasks, useSpecMutations } from "./useSpecs";

const KIND_LABELS: Record<RequirementKind, string> = {
  functional: "Functional",
  non_functional: "Non-functional",
  user_story: "User story",
  constraint: "Constraint",
};
const NO_PRIORITY = "__none__";

/** Add/edit form. `initial` undefined = a new manual requirement. */
export function RequirementForm({
  initial,
  onSubmit,
  pending,
  submitLabel,
}: {
  initial?: Requirement;
  onSubmit: (draft: RequirementDraft) => void;
  pending: boolean;
  submitLabel: string;
}) {
  const [kind, setKind] = useState<RequirementKind>(initial?.kind ?? "functional");
  const [priority, setPriority] = useState<RequirementPriority | null>(initial?.priority ?? null);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSubmit({
          key: initial ? undefined : String(fd.get("key") ?? "").trim() || null,
          title: String(fd.get("title") ?? "").trim(),
          statement: String(fd.get("statement") ?? "").trim(),
          kind,
          priority,
          acceptance_criteria: String(fd.get("criteria") ?? "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        });
      }}
    >
      {!initial ? (
        <div className="grid gap-1.5">
          <Label htmlFor="req-key">Key (optional)</Label>
          <Input id="req-key" name="key" placeholder="Next R-number if left blank" />
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="req-title">Title</Label>
        <Input id="req-title" name="title" required defaultValue={initial?.title} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="req-statement">Statement</Label>
        <Textarea id="req-statement" name="statement" rows={3} defaultValue={initial?.statement} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as RequirementKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Priority</Label>
          <Select
            value={priority ?? NO_PRIORITY}
            onValueChange={(v) => setPriority(v === NO_PRIORITY ? null : (v as RequirementPriority))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PRIORITY}>Not stated</SelectItem>
              <SelectItem value="must">Must</SelectItem>
              <SelectItem value="should">Should</SelectItem>
              <SelectItem value="could">Could</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="req-criteria">Acceptance criteria (one per line)</Label>
        <Textarea
          id="req-criteria"
          name="criteria"
          rows={4}
          defaultValue={initial?.acceptance_criteria.map((c) => c.text).join("\n")}
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TaskPicker({
  projectId,
  exclude,
  onPick,
  disabled,
}: {
  projectId: number;
  exclude: Set<number>;
  onPick: (taskId: number) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const { data: tasks } = useProjectTasks(projectId);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (tasks ?? [])
      .filter((t) => !exclude.has(t.id))
      .filter((t) => `${taskLabel(t)} ${t.title}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [tasks, query, exclude]);

  return (
    <div className="space-y-1.5">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tasks by key or title to link…"
        className="h-8"
      />
      {matches.length ? (
        <ul className="divide-y rounded-md border">
          {matches.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(t.id);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent/50"
              >
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{taskLabel(t)}</span>
                <span className="truncate">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p className="text-xs text-muted-foreground">No matching tasks.</p>
      ) : null}
    </div>
  );
}

/** One requirement: what it says, which work implements it, and (with rights) edits. */
export function RequirementDialog({
  projectId,
  spec,
  requirement,
  onClose,
}: {
  projectId: number;
  spec: SpecDetail;
  requirement: Requirement | null;
  onClose: () => void;
}) {
  const access = useAccess(projectId);
  const canEdit = access.can("spec") && spec.source === "document";
  const canLink = access.can("task");
  const m = useSpecMutations(projectId, spec.id);
  const [editing, setEditing] = useState(false);
  const [, setParams] = useSearchParams();

  if (!requirement) return null;
  const r = requirement;
  const openTask = (taskId: number) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("task", String(taskId));
      return next;
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) {
          setEditing(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="font-mono text-sm text-muted-foreground">{r.key}</span>
            {r.title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-1.5">
              {requirementStatusBadge(r.status)}
              <Badge variant="outline">{KIND_LABELS[r.kind]}</Badge>
              {r.priority ? <Badge variant="secondary">{r.priority}</Badge> : null}
              {changeBadge(r.change_state, r.changed_in_version)}
            </div>
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <RequirementForm
            initial={r}
            pending={m.patchRequirement.isPending}
            submitLabel="Save"
            onSubmit={(draft) =>
              m.patchRequirement.mutate(
                {
                  id: r.id,
                  body: {
                    title: draft.title,
                    statement: draft.statement,
                    kind: draft.kind,
                    priority: draft.priority ?? undefined,
                    clear_priority: draft.priority === null,
                    acceptance_criteria: draft.acceptance_criteria,
                  },
                },
                { onSuccess: () => setEditing(false) },
              )
            }
          />
        ) : (
          <div className="space-y-4 text-sm">
            {r.statement ? <p>{r.statement}</p> : null}

            <AcceptanceCriteria projectId={projectId} specId={spec.id} requirement={r} />

            {r.source_excerpt ? (
              <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground">
                {r.source_excerpt}
              </blockquote>
            ) : null}

            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Implemented by ({r.tasks.length})
              </div>
              {r.tasks.length ? (
                <ul className="mb-2 divide-y rounded-md border">
                  {r.tasks.map((t) => (
                    <li key={t.task_id} className="flex items-center gap-2 px-2.5 py-1.5">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                        onClick={() => openTask(t.task_id)}
                      >
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.key}</span>
                        <span className="truncate">{t.title}</span>
                      </button>
                      {taskCategoryBadge(t.status_category, t.status)}
                      {t.needs_review ? (
                        canLink ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-warning/40 text-warning"
                            title="The requirement changed after this link was made. Clear once you've checked the task still fits."
                            onClick={() => m.reviewed.mutate({ requirementId: r.id, taskId: t.task_id })}
                          >
                            <Check className="size-3.5" /> Still fits
                          </Button>
                        ) : (
                          <span className="text-xs text-warning">Needs review</span>
                        )
                      ) : null}
                      {canLink ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground"
                          onClick={() => m.unlink.mutate({ requirementId: r.id, taskId: t.task_id })}
                        >
                          <X className="size-3.5" />
                          <span className="sr-only">Unlink</span>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-2 text-muted-foreground">No work is linked yet.</p>
              )}
              {canLink && r.status !== "removed" ? (
                <TaskPicker
                  projectId={projectId}
                  exclude={new Set(r.tasks.map((t) => t.task_id))}
                  disabled={m.link.isPending}
                  onPick={(taskId) => m.link.mutate({ requirementId: r.id, taskId })}
                />
              ) : null}
            </div>

            {canEdit ? (
              <div className="flex justify-between border-t pt-3">
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm" className="text-destructive">
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  }
                  title={`Delete ${r.key}?`}
                  description="Removes the requirement and its task links. A later version of the document may extract it again."
                  onConfirm={() => m.deleteRequirement.mutate(r.id, { onSuccess: onClose })}
                />
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
