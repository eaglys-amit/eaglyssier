import { useQuery } from "@tanstack/react-query";

import { Spinner } from "@/components/shared/Spinner";
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
import { api } from "@/lib/api";
import { taskLabel } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type {
  Deck,
  ProjectMembers,
  StatusCategory,
  Task,
  TaskCreateIn,
  TaskDetail,
  TaskNode,
} from "@/types/api";

/** Sentinel: a Radix Select value can't be null or an empty string. */
const NONE = "none";

const CATEGORIES: { value: StatusCategory; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

/**
 * Create or edit a task. Uncontrolled form read through FormData on submit,
 * matching NewProjectDialog and the integrations ConnectForm — the only
 * controlled pieces are the Selects, which Radix requires.
 *
 * Editing fetches the task detail, because the board's list payload
 * deliberately omits description and acceptance criteria (they'd bloat a
 * hundred-row response). The form is keyed on that fetch so `defaultValue`
 * re-seeds once it lands.
 */
export function TaskDialog({
  projectId,
  open,
  onOpenChange,
  taskId,
  defaultSprintId,
  defaultIssueType,
  parent,
  busy,
  onSubmit,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Editing when set, creating when null. An id rather than a Task: everything
   * the form needs comes from the detail fetch, so callers holding a TaskNode
   * (the Epics tree) don't have to cast it into a shape it isn't.
   */
  taskId?: number | null;
  defaultSprintId?: number | null;
  /** Seeds Type on create — the Epics view opens this with "Epic". */
  defaultIssueType?: string;
  /** Set when adding a subtask, so the copy can say what it attaches to. */
  parent?: Task | null;
  busy: boolean;
  onSubmit: (body: TaskCreateIn) => void;
}) {
  const editing = taskId != null;

  const { data: detail, isPending: detailPending } = useQuery({
    queryKey: qk.task(taskId ?? 0),
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: open && editing,
  });

  const { data: members } = useQuery({
    queryKey: qk.projectMembers(projectId),
    queryFn: () => api.get<ProjectMembers>(`/projects/${projectId}/members`),
    enabled: open,
  });

  // The scale is the estimate picker, so an estimate can only ever be a value
  // the team actually uses — and a break-it-down value is labelled as such.
  const { data: deck } = useQuery({
    queryKey: qk.deck(projectId),
    queryFn: () => api.get<Deck>(`/projects/${projectId}/story-points/deck`),
    enabled: open,
  });

  // Candidate epics. Only fetched when the picker is actually rendered — the
  // "add a subtask to X" flow already knows its parent.
  const { data: tree } = useQuery({
    queryKey: qk.taskTree(projectId),
    queryFn: () => api.get<TaskNode[]>(`/projects/${projectId}/task-tree`),
    enabled: open && !parent,
  });

  // Roots only, minus this task. Excluding self is sufficient: everything below
  // it has a parent, so no descendant can be a root and be offered here.
  const epicOptions = (tree ?? []).filter((n) => n.id !== taskId);

  const isSynced = detail?.source === "sync";
  const loading = editing && detailPending;

  // The task's current estimate, when the scale doesn't list it.
  const current = detail?.story_points ?? null;
  const offDeck =
    current != null && deck && !deck.points.includes(current) ? current : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit ${detail ? taskLabel({ id: detail.id, external_key: detail.key }) : ""}`
              : parent
                ? `Add a subtask to ${taskLabel(parent)}`
                : "New task"}
          </DialogTitle>
          {isSynced ? (
            <DialogDescription>
              This task came from a connector. Title, status and points will be overwritten on the
              next sync — the parent, priority and acceptance criteria will not.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> Loading task…
          </div>
        ) : (
          <form
            // Remount when the fetched detail arrives so defaultValue re-seeds.
            key={detail?.id ?? "new"}
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const str = (name: string) => String(fd.get(name) ?? "").trim() || null;
              const num = (name: string) => {
                const raw = String(fd.get(name) ?? "");
                return raw && raw !== NONE ? Number(raw) : null;
              };
              onSubmit({
                title: String(fd.get("title") ?? "").trim(),
                description: str("description"),
                acceptance_criteria: str("acceptance_criteria"),
                issue_type: str("issue_type"),
                story_points: num("story_points"),
                status_category: (fd.get("status_category") as StatusCategory) || "todo",
                sprint_id: num("sprint_id"),
                assignee_member_id: num("assignee_member_id"),
                // The explicit `parent` prop wins: it's the "add a subtask to X"
                // flow, where the select isn't rendered at all.
                parent_id: parent?.id ?? num("parent_id"),
              });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                name="title"
                required
                autoFocus
                defaultValue={detail?.title ?? ""}
                placeholder="Add rate limiting to the public API"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="description" className="text-xs text-muted-foreground">
                Description
              </Label>
              <Textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={detail?.description ?? ""}
                placeholder="What this covers and why."
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="acceptance_criteria" className="text-xs text-muted-foreground">
                Acceptance criteria
              </Label>
              <Textarea
                id="acceptance_criteria"
                name="acceptance_criteria"
                rows={2}
                defaultValue={detail?.acceptance_criteria ?? ""}
                placeholder="One per line — what has to be true to call this done."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="story_points" className="text-xs text-muted-foreground">
                  Story points
                </Label>
                <Select
                  name="story_points"
                  defaultValue={
                    detail?.story_points != null ? String(detail.story_points) : NONE
                  }
                >
                  <SelectTrigger id="story_points">
                    <SelectValue placeholder="No estimate" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No estimate</SelectItem>
                    {/* A synced task can carry an estimate the scale doesn't
                        define. Without it as an option the Select would render
                        empty and saving would silently wipe a real value. */}
                    {offDeck != null ? (
                      <SelectItem value={String(offDeck)}>
                        {offDeck} · not on this project's scale
                      </SelectItem>
                    ) : null}
                    {(deck?.points ?? []).map((points) => (
                      <SelectItem key={points} value={String(points)}>
                        {points}
                        {deck?.labels[String(points)]
                          ? ` · ${deck.labels[String(points)]}`
                          : ""}
                        {deck?.needs_breakdown.includes(points) ? " · break down" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="status_category" className="text-xs text-muted-foreground">
                  Status
                </Label>
                <Select name="status_category" defaultValue={detail?.status_category ?? "todo"}>
                  <SelectTrigger id="status_category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="issue_type" className="text-xs text-muted-foreground">
                  Type
                </Label>
                <Input
                  id="issue_type"
                  name="issue_type"
                  defaultValue={detail?.issue_type ?? defaultIssueType ?? ""}
                  placeholder="Story"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="assignee_member_id" className="text-xs text-muted-foreground">
                  Assignee
                </Label>
                <Select
                  name="assignee_member_id"
                  defaultValue={
                    detail?.assignee_member_id != null ? String(detail.assignee_member_id) : NONE
                  }
                >
                  <SelectTrigger id="assignee_member_id">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {(members?.members ?? []).map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Absent when `parent` is set: that dialog is already scoped to a
                parent, and a second control naming a different one would be two
                answers to the same question. */}
            {!parent ? (
              <div className="grid gap-1.5">
                <Label htmlFor="parent_id" className="text-xs text-muted-foreground">
                  Epic
                </Label>
                <Select
                  name="parent_id"
                  defaultValue={
                    detail?.parent_id != null ? String(detail.parent_id) : NONE
                  }
                >
                  <SelectTrigger id="parent_id">
                    <SelectValue placeholder="Not part of an epic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not part of an epic</SelectItem>
                    {epicOptions.map((n) => (
                      <SelectItem key={n.id} value={String(n.id)}>
                        {taskLabel(n)} · {n.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {/* Hidden rather than absent: on create the board's selected sprint
                is the sensible default, and on edit the row's own Select owns
                moves, so this just round-trips the current value. */}
            <input
              type="hidden"
              name="sprint_id"
              value={String(detail?.sprint_id ?? defaultSprintId ?? NONE)}
            />

            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save changes" : "Create task"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
