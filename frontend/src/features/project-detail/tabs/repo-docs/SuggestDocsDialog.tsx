import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Folder, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Spinner } from "@/components/shared/Spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { RepoDocSet, RepoDocSuggestions } from "@/types/api";

/**
 * What else this repository should have documented, proposed by the model.
 *
 * A review, not an import — SyncMembersDialog's shape and its framing. Nothing
 * is written until the footer is pressed, and a proposal whose path is already
 * in the set arrives flagged `existing` and seeds UNCHECKED, because otherwise
 * "accept" quietly grows a second copy of a document that is already there.
 */
export function SuggestDocsDialog({
  repoId,
  open,
  onOpenChange,
}: {
  repoId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const suggestions = useQuery({
    queryKey: qk.repoDocSuggestions(repoId),
    queryFn: () =>
      api.get<RepoDocSuggestions>(`/repos/${repoId}/doc-set/suggestions`),
    enabled: open,
    // Always re-derive on open: a sync may have landed commits since, and a
    // stale proposal is worse than a slow one. Same reason SyncMembersDialog
    // sets it.
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });

  const ask = useMutation({
    mutationFn: () =>
      api.post<RepoDocSuggestions>(`/repos/${repoId}/doc-set/suggest`),
    onSuccess: (row) => qc.setQueryData(qk.repoDocSuggestions(repoId), row),
    onError: (err: ApiError) =>
      toast.error(err.detail || "Could not ask for suggestions"),
  });

  const accept = useMutation({
    mutationFn: (refs: string[]) =>
      api.post<RepoDocSet>(`/repos/${repoId}/doc-set/suggestions/accept`, { refs }),
    onSuccess: (set) => {
      // The set key is a prefix of the suggestions key, so this one call
      // refreshes both.
      qc.setQueryData(qk.repoDocSet(repoId), set);
      qc.invalidateQueries({ queryKey: qk.repoDocSet(repoId) });
      toast.success("Added to the set");
      onOpenChange(false);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not add those"),
  });

  const dismiss = useMutation({
    mutationFn: () => api.delete(`/repos/${repoId}/doc-set/suggestions`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.repoDocSet(repoId) });
      onOpenChange(false);
    },
  });

  const data = suggestions.data;
  const items = data?.items ?? [];

  // Seed from the proposal: genuinely new rows checked, ones already in the set
  // left off.
  useEffect(() => {
    setPicked(new Set(items.filter((i) => !i.existing).map((i) => i.ref)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const toggle = (ref: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  // A ticked document implies the folder it needs. The server closes over this
  // too — doing it here as well is what lets the footer count honestly.
  const effective = new Set(picked);
  for (const item of items) {
    if (picked.has(item.ref) && item.parent_ref) effective.add(item.parent_ref);
  }
  const folderCount = items.filter(
    (i) => i.kind === "folder" && effective.has(i.ref) && !i.existing,
  ).length;
  const docCount = items.filter((i) => i.kind === "doc" && effective.has(i.ref)).length;

  const running = data?.status === "running" || ask.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Suggest more documents</DialogTitle>
          <DialogDescription>
            The model reads this repository and proposes documents the standard
            set doesn't cover. Nothing is added until you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {running ? (
            <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Spinner /> Reading the repository…
            </div>
          ) : data?.status === "failed" ? (
            <ErrorAlert message={data.error ?? "The model could not be reached."} />
          ) : !items.length ? (
            <div className="py-6 text-sm">
              <p className="text-muted-foreground">
                {data?.status === "ready"
                  ? "The model had nothing to add — it considers the current set adequate for this repository."
                  : "Ask the model what else this repository needs documented."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const label = item.title ?? item.name ?? item.ref;
                const implied =
                  item.kind === "folder" &&
                  !picked.has(item.ref) &&
                  effective.has(item.ref);
                return (
                  <li key={item.ref} className="flex items-start gap-3 py-2.5">
                    <Checkbox
                      className="mt-0.5"
                      checked={effective.has(item.ref)}
                      disabled={implied}
                      onCheckedChange={() => toggle(item.ref)}
                      aria-label={`Add ${label}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {item.kind === "folder" ? (
                          <Folder className="text-muted-foreground size-3.5 shrink-0" />
                        ) : (
                          <FileText className="text-muted-foreground size-3.5 shrink-0" />
                        )}
                        <span
                          className={cn(
                            "truncate text-sm font-medium",
                            item.existing && "text-muted-foreground",
                          )}
                        >
                          {item.path}
                        </span>
                        {item.existing ? (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            already in the set
                          </span>
                        ) : null}
                        {implied ? (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            needed by a document below
                          </span>
                        ) : null}
                      </div>
                      {item.rationale ? (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {item.rationale}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={running}
              onClick={() => ask.mutate()}
            >
              <Sparkles className="size-4" />
              {items.length ? "Ask again" : "Ask the model"}
            </Button>
            {items.length ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate()}
              >
                Discard
              </Button>
            ) : null}
          </div>
          <Button
            disabled={accept.isPending || (!folderCount && !docCount)}
            onClick={() => accept.mutate([...effective])}
          >
            {folderCount || docCount
              ? `Add ${[
                  folderCount && `${folderCount} folder${folderCount === 1 ? "" : "s"}`,
                  docCount && `${docCount} document${docCount === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" and ")}`
              : "Nothing selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
