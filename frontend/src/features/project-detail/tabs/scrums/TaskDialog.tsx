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
  ProjectMembers,
  StatusCategory,
  StoryPointRow,
  Task,
  TaskCreateIn,
  TaskDetail,
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
  task,
  defaultSprintId,
  parent,
  busy,
  onSubmit,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing when present, creating when not. */
  task?: Task | null;
  defaultSprintId?: number | null;
  /** Set when adding a subtask, so the copy can say what it attaches to. */
  parent?: Task | null;
  busy: boolean;
  onSubmit: (body: TaskCreateIn) => void;
}) {
  const editing = Boolean(task);

  const { data: detail, isPending: detailPending } = useQuery({
    queryKey: qk.task(task?.id ?? 0),
    queryFn: () => api.get<TaskDetail>(`/tasks/${task!.id}`),
    enabled: open && editing,
  });

  const { data: members } = useQuery({
    queryKey: qk.projectMembers(projectId),
    queryFn: () => api.get<ProjectMembers>(`/projects/${projectId}/members`),
    enabled: open,
  });

  // The project's scale doubles as the estimate picker, so an estimate can only
  // ever be a value the team actually uses.
  const { data: scale } = useQuery({
    queryKey: qk.storyPoints(projectId),
    queryFn: () => api.get<StoryPointRow[]>(`/projects/${projectId}/story-points`),
    enabled: open,
  });

  const isSynced = task?.source === "sync";
  const loading = editing && detailPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit ${taskLabel(task!)}`
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
                parent_id: parent?.id ?? task?.parent_id ?? null,
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
                    {(scale ?? []).map((row) => (
                      <SelectItem key={row.points} value={String(row.points)}>
                        {row.points}
                        {row.note ? ` · ${row.note}` : ""}
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
                  defaultValue={detail?.issue_type ?? ""}
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

            {/* Hidden rather than absent: on create the board's selected sprint
                is the sensible default, and on edit the row's own Select owns
                moves, so this just round-trips the current value. */}
            <input
              type="hidden"
              name="sprint_id"
              value={String(task?.sprint_id ?? defaultSprintId ?? NONE)}
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
