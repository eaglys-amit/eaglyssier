import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, type ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { RepoDoc, RepoDocDetail, RepoDocGenerateIn } from "@/types/api";

import { isActive } from "./doc-tree";

/**
 * One document: its markdown, its own generation job, and its saves.
 *
 * Polled on this document's status alone, unlike the set query — the body can
 * be 100KB, and re-fetching it every 2s because some *other* document in the
 * queue is generating would be pure waste.
 */
export function useRepoDoc(docId: number | null, repoId: number | null) {
  const qc = useQueryClient();
  const key = qk.repoDoc(docId ?? 0);

  const detail = useQuery({
    queryKey: key,
    queryFn: () => api.get<RepoDocDetail>(`/repo-docs/${docId}`),
    enabled: docId != null,
    refetchInterval: (q) => (isActive(q.state.data?.status) ? 2000 : false),
  });

  const invalidateSet = () => {
    if (repoId != null) qc.invalidateQueries({ queryKey: qk.repoDocSet(repoId) });
  };

  // When *this* document settles, refresh the set so the rail's status dot and
  // the queue counter move without waiting for the set's own 2s tick.
  const wasActive = useRef(false);
  useEffect(() => {
    const active = isActive(detail.data?.status);
    if (wasActive.current && !active) invalidateSet();
    wasActive.current = active;
    // invalidateSet is stable enough for this; repoId is the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data?.status, repoId]);

  const generate = useMutation({
    mutationFn: (body: RepoDocGenerateIn) =>
      api.post<RepoDoc>(`/repo-docs/${docId}/generate`, body),
    onSuccess: (row) => {
      // The 202 body already carries the queued row, so seed the status rather
      // than refetching — the badge flips at once and the poll takes over from
      // a correct starting state. Merged into the cached detail so the markdown
      // currently on screen isn't blanked while it regenerates.
      qc.setQueryData<RepoDocDetail>(key, (prev) =>
        prev ? { ...prev, ...row } : undefined,
      );
      invalidateSet();
    },
    onError: (err: ApiError) =>
      toast.error(err.detail || "Could not start writing this document"),
  });

  const cancel = useMutation({
    mutationFn: () => api.post<RepoDoc>(`/repo-docs/${docId}/generate/cancel`),
    onSuccess: (row) => {
      qc.setQueryData<RepoDocDetail>(key, (prev) =>
        prev ? { ...prev, ...row } : undefined,
      );
      invalidateSet();
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not stop it"),
  });

  const save = useMutation({
    mutationFn: (body: { markdown: string; base_rev: number }) =>
      api.put<RepoDocDetail>(`/repo-docs/${docId}/content`, body),
    onSuccess: (row) => {
      qc.setQueryData(key, row);
      // char_count, hand_edited and updated_at all show in the tree.
      invalidateSet();
      toast.success("Saved");
    },
    onError: (err: ApiError) =>
      toast.error(
        err.status === 409
          ? err.detail
          : err.detail || "Could not save this document",
      ),
  });

  return {
    doc: detail.data,
    isLoading: detail.isLoading && docId != null,
    error: detail.error as ApiError | null,
    generate,
    cancel,
    save,
  };
}
