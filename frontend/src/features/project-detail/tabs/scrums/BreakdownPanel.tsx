import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { jobBadge } from "@/components/shared/StatusBadge";
import { Spinner } from "@/components/shared/Spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { formatPoints } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type {
  BreakdownAcceptOut,
  Deck,
  ReferenceFile,
  TaskBreakdown,
} from "@/types/api";

import {
  acceptedIds,
  countAccepted,
  removeNode,
  setNode,
  toDraft,
  toggleAccept,
  toWire,
  type DraftNode,
} from "./breakdown-draft";
import { BreakdownTree } from "./BreakdownTree";

/**
 * Draft a work tree from the selected reference documents.
 *
 * The big-editor pattern from EvaluationSheetEditor: the draft is held in local
 * state with a dirty flag and an explicit action, because a tree isn't
 * expressible as FormData and autosaving a throwaway draft would be pointless.
 */
export function BreakdownPanel({
  projectId,
  sprintId,
  files,
}: {
  projectId: number;
  sprintId: number | null;
  files: ReferenceFile[];
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [instructions, setInstructions] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftNode[] | null>(null);
  const [dirty, setDirty] = useState(false);

  // Only documents with extractable text can inform a prompt.
  const usable = files.filter((f) => f.extract_status === "ready" && f.char_count > 0);

  const { data: deck } = useQuery({
    queryKey: qk.deck(projectId),
    queryFn: () => api.get<Deck>(`/projects/${projectId}/story-points/deck`),
  });

  const { data: breakdowns } = useQuery({
    queryKey: qk.breakdowns(projectId),
    queryFn: () => api.get<TaskBreakdown[]>(`/projects/${projectId}/breakdowns`),
  });

  // Resume whatever is in flight or freshly drafted, so a refresh doesn't lose it.
  const latest = breakdowns?.find(
    (b) => b.status === "running" || b.status === "ready" || b.status === "failed",
  );
  const currentId = activeId ?? latest?.id ?? null;

  const { data: current } = useQuery({
    queryKey: qk.breakdown(currentId ?? 0),
    queryFn: () => api.get<TaskBreakdown>(`/breakdowns/${currentId}`),
    enabled: currentId != null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });

  // Seed the editable copy whenever the server has something newer and the user
  // has no unsaved edits — the EvaluationSheetEditor guard.
  useEffect(() => {
    if (current?.draft && !dirty) setDraft(toDraft(current.draft.nodes));
  }, [current, dirty]);

  const generate = useMutation({
    mutationFn: () =>
      api.post<TaskBreakdown>(`/projects/${projectId}/breakdowns`, {
        reference_file_ids: selected,
        instructions: instructions.trim() || null,
        sprint_id: sprintId,
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: qk.breakdowns(projectId) });
      setActiveId(row.id);
      setDraft(null);
      setDirty(false);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start the breakdown"),
  });

  const regenerate = useMutation({
    mutationFn: () => api.post<TaskBreakdown>(`/breakdowns/${currentId}/regenerate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.breakdown(currentId ?? 0) });
      setDirty(false);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not re-run"),
  });

  const accept = useMutation({
    mutationFn: async () => {
      // Persist edits first, so what gets created is exactly what's on screen.
      if (dirty && draft) {
        await api.put<TaskBreakdown>(`/breakdowns/${currentId}/draft`, {
          nodes: toWire(draft),
        });
      }
      return api.post<BreakdownAcceptOut>(`/breakdowns/${currentId}/accept`, {
        node_ids: draft ? acceptedIds(draft) : [],
        sprint_id: sprintId,
      });
    },
    onSuccess: (result) => {
      for (const key of [
        qk.breakdowns(projectId),
        qk.board(projectId),
        qk.tasks(projectId),
        qk.taskTree(projectId),
        qk.sprints(projectId),
        qk.scaleViolations(projectId),
      ]) {
        qc.invalidateQueries({ queryKey: key });
      }
      setActiveId(null);
      setDraft(null);
      setDirty(false);
      toast.success(
        `Created ${result.created} ${result.created === 1 ? "task" : "tasks"}`,
      );
      for (const w of result.warnings) toast.warning(w);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not create the tasks"),
  });

  const edit = (id: string, patch: Partial<DraftNode>) => {
    setDraft((d) => (d ? setNode(d, id, patch) : d));
    setDirty(true);
  };

  if (!deck?.points.length) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No story-point scale yet"
        hint="The breakdown estimates against the project's scale, so there has to be one first."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to={`/projects/${projectId}/capacity`}>Set the scale</Link>
          </Button>
        }
      />
    );
  }

  const running = current?.status === "running";
  const totals = draft ? countAccepted(draft) : { tasks: 0, points: 0 };

  return (
    <div className="space-y-4">
      {/* ---- inputs -------------------------------------------------- */}
      {!draft && !running ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Draft tasks from documents</h3>
            <p className="text-xs text-muted-foreground">
              Claude reads the documents you pick and proposes an epic / task / subtask tree with
              estimates from this project's scale. Nothing is created until you accept it.
            </p>
          </div>

          {!usable.length ? (
            <p className="text-xs text-muted-foreground">
              Upload a document with readable text first — a scanned PDF has nothing to read.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Documents</Label>
              {usable.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(f.id)}
                    onCheckedChange={(v) =>
                      setSelected((s) =>
                        v === true ? [...s, f.id] : s.filter((x) => x !== f.id),
                      )
                    }
                  />
                  <span className="truncate">{f.filename}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {f.char_count.toLocaleString()} chars
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="instructions" className="text-xs text-muted-foreground">
              Extra instructions (optional)
            </Label>
            <Textarea
              id="instructions"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Team is two backend engineers. Keep it to one sprint if possible."
            />
          </div>

          <Button
            size="sm"
            disabled={!selected.length || generate.isPending}
            onClick={() => generate.mutate()}
          >
            <Wand2 className="size-4" />
            {generate.isPending ? "Starting…" : "Draft the tree"}
          </Button>
        </div>
      ) : null}

      {/* ---- job state ----------------------------------------------- */}
      {running ? (
        <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
          <Spinner />
          Reading {current?.reference_filenames.join(", ")} and drafting the tree…
        </div>
      ) : null}

      {current?.status === "failed" ? (
        <div className="space-y-2">
          <ErrorAlert message={current.error ?? "The breakdown failed."} />
          <Button size="sm" variant="outline" onClick={() => regenerate.mutate()}>
            <RotateCcw className="size-4" /> Try again
          </Button>
        </div>
      ) : null}

      {/* ---- the draft ----------------------------------------------- */}
      {draft && !running ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight">Proposed tasks</h3>
              {current ? jobBadge(current.status === "accepted" ? "done" : "ready") : null}
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {totals.tasks} selected · {formatPoints(totals.points)} pts
              </span>
              {current?.model ? (
                <span className="text-xs text-muted-foreground">via {current.model}</span>
              ) : null}
              {dirty ? (
                <span className="text-xs text-warning">edited — saved when you create</span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" onClick={() => regenerate.mutate()}>
                <RotateCcw className="size-3.5" /> Re-run
              </Button>
              <Button
                size="sm"
                disabled={!totals.tasks || accept.isPending}
                onClick={() => accept.mutate()}
              >
                {accept.isPending
                  ? "Creating…"
                  : `Create ${totals.tasks} ${totals.tasks === 1 ? "task" : "tasks"}`}
              </Button>
            </div>
          </div>

          <BreakdownTree
            nodes={draft}
            deck={deck}
            onToggle={(id, accepted) => {
              setDraft((d) => (d ? toggleAccept(d, id, accepted) : d));
              setDirty(true);
            }}
            onEdit={edit}
            onRemove={(id) => {
              setDraft((d) => (d ? removeNode(d, id) : d));
              setDirty(true);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
