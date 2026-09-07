import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, type ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type {
  RepoDoc,
  RepoDocCancelOut,
  RepoDocGenerateIn,
  RepoDocFolder,
  RepoDocGenerateAllIn,
  RepoDocQueueOut,
  RepoDocSet,
} from "@/types/api";

import { isActive } from "./doc-tree";

/**
 * The whole documentation set, plus every structural mutation over it.
 *
 * One query for the set rather than one per folder: the rail needs every row
 * anyway to roll statuses up, and filtering in memory beats a fetch per click —
 * the same reasoning as useReferenceFiles. The set deliberately carries no
 * markdown, which is what makes the 2s queue poll cheap.
 */
export function useRepoDocs(projectId: number, repoId: number | null) {
  const qc = useQueryClient();
  const key = qk.repoDocSet(repoId ?? 0);
  const enabled = repoId != null;

  const set = useQuery({
    queryKey: key,
    queryFn: () => api.get<RepoDocSet>(`/repos/${repoId}/doc-set`),
    enabled,
    // Poll only while something is in flight — ReposSection's predicate,
    // widened to cover a whole draining queue rather than one job.
    refetchInterval: (q) =>
      q.state.data?.docs.some((d) => isActive(d.status)) ? 2000 : false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  // When a queue finishes, the things that read these statuses from elsewhere
  // are stale — the picker's rollup in particular. Same wasRunning-ref shape as
  // ReposSection, which has to fire on the settle rather than on every tick.
  const wasActive = useRef(false);
  useEffect(() => {
    const active = set.data?.docs.some((d) => isActive(d.status)) ?? false;
    if (wasActive.current && !active) {
      qc.invalidateQueries({ queryKey: qk.repoDocsOverview(projectId) });
      toast.success("Documentation set finished generating");
    }
    wasActive.current = active;
  }, [set.data, qc, projectId]);

  const fail = (fallback: string) => (err: ApiError) =>
    toast.error(err.detail || fallback);

  const seed = useMutation<RepoDocSet, ApiError, boolean | undefined>({
    mutationFn: (restoreMissing) =>
      api.post<RepoDocSet>(`/repos/${repoId}/doc-set/seed`, {
        restore_missing: restoreMissing ?? false,
      }),
    // The response *is* the new set, so seed it rather than round-tripping.
    onSuccess: (next) => qc.setQueryData(key, next),
    onError: fail("Could not set up the documentation set"),
  });

  const createFolder = useMutation({
    mutationFn: (body: { name: string; parent_id: number | null }) =>
      api.post<RepoDocFolder>(`/repos/${repoId}/doc-folders`, body),
    onSuccess: () => {
      invalidate();
      toast.success("Folder created");
    },
    onError: fail("Could not create the folder"),
  });

  const updateFolder = useMutation({
    // parent_id is sent only when it is actually being changed: an absent field
    // means "leave the parent alone" server-side, so including it as undefined
    // is fine but including it as null would move the folder to the root. The
    // useReferenceFolders trap, in the other direction.
    mutationFn: ({
      folderId,
      ...body
    }: {
      folderId: number;
      name?: string;
      parent_id?: number | null;
    }) => api.patch<RepoDocFolder>(`/repos/${repoId}/doc-folders/${folderId}`, body),
    onSuccess: () => invalidate(),
    onError: fail("Could not update the folder"),
  });

  const deleteFolder = useMutation({
    mutationFn: (folderId: number) =>
      api.delete(`/repos/${repoId}/doc-folders/${folderId}`),
    onSuccess: () => {
      invalidate();
      toast.success("Folder deleted");
    },
    onError: fail("Could not delete the folder"),
  });

  const createDoc = useMutation({
    mutationFn: (body: {
      title: string;
      folder_id: number | null;
      guidance?: string | null;
    }) => api.post<RepoDoc>(`/repos/${repoId}/docs`, body),
    onSuccess: () => {
      invalidate();
      toast.success("Document added");
    },
    onError: fail("Could not add the document"),
  });

  const updateDoc = useMutation({
    mutationFn: ({
      docId,
      ...body
    }: {
      docId: number;
      title?: string;
      folder_id?: number | null;
      guidance?: string | null;
    }) => api.patch<RepoDoc>(`/repo-docs/${docId}`, body),
    onSuccess: (row) => {
      invalidate();
      qc.invalidateQueries({ queryKey: qk.repoDoc(row.id) });
    },
    onError: fail("Could not update the document"),
  });

  const deleteDoc = useMutation({
    mutationFn: (docId: number) => api.delete(`/repo-docs/${docId}`),
    onSuccess: (_res, docId) => {
      invalidate();
      // Otherwise the detail cache keeps a deleted document alive if the user
      // navigates back to a stale ?doc= link.
      qc.removeQueries({ queryKey: qk.repoDoc(docId) });
      toast.success("Document deleted");
    },
    onError: fail("Could not delete the document"),
  });

  /**
   * Queue one document, from the page rather than from the open pane.
   *
   * It lives here because the generate dialog is owned by RepoDocsTab and can
   * target a document that isn't currently open — so there is no mounted
   * useRepoDoc to go through. That hook keeps its own copy for the pane's own
   * button, where seeding the already-loaded detail matters.
   */
  const generateDoc = useMutation({
    mutationFn: ({ docId, ...body }: { docId: number } & RepoDocGenerateIn) =>
      api.post<RepoDoc>(`/repo-docs/${docId}/generate`, body),
    onSuccess: (row) => {
      invalidate();
      qc.invalidateQueries({ queryKey: qk.repoDoc(row.id) });
    },
    onError: fail("Could not start writing this document"),
  });

  const generateAll = useMutation({
    mutationFn: (body: RepoDocGenerateAllIn) =>
      api.post<RepoDocQueueOut>(`/repos/${repoId}/doc-set/generate`, body),
    onSuccess: (res) => {
      invalidate();
      toast.success(
        res.queued
          ? `Queued ${res.queued} document${res.queued === 1 ? "" : "s"}`
          : "Nothing to generate",
      );
    },
    onError: fail("Could not start generating"),
  });

  const cancelAll = useMutation({
    mutationFn: () =>
      api.post<RepoDocCancelOut>(`/repos/${repoId}/doc-set/generate/cancel`),
    onSuccess: (res) => {
      invalidate();
      toast.success(`Stopped ${res.cancelled} document${res.cancelled === 1 ? "" : "s"}`);
    },
    onError: fail("Could not stop the queue"),
  });

  return {
    set: set.data,
    isLoading: set.isLoading && enabled,
    error: set.error as ApiError | null,
    invalidate,
    seed,
    createFolder,
    updateFolder,
    deleteFolder,
    createDoc,
    updateDoc,
    deleteDoc,
    generateDoc,
    generateAll,
    cancelAll,
  };
}
