import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { AnalysisScope } from "@/types/api";

export const EMPTY_SCOPE: AnalysisScope = {
  sprint_ids: [],
  repo_ids: [],
  start_date: null,
  end_date: null,
};

function toggled(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
}

/** The active member's saved data selection, saved on every change
 *  (full-replace PUT with an optimistic cache update). When no member is
 *  active (memberId null), the scope is empty and edits are no-ops. */
export function useMemberScope(projectId: number, memberId: number | null) {
  const qc = useQueryClient();
  const key = memberId != null ? qk.memberScope(projectId, memberId) : ["member-scope", "none"];

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.get<AnalysisScope>(`/projects/${projectId}/members/${memberId}/scope`),
    enabled: memberId != null,
  });
  const scope = data ?? EMPTY_SCOPE;

  const save = useMutation({
    mutationKey: key,
    mutationFn: (next: AnalysisScope) =>
      api.put<AnalysisScope>(`/projects/${projectId}/members/${memberId}/scope`, next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AnalysisScope>(key);
      qc.setQueryData(key, next);
      return { previous };
    },
    onError: (err: ApiError, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(err.detail || "Could not save analysis scope");
    },
    // Server response is the sanitized truth (stale ids dropped, dates ordered)
    // — but only when no newer save is already in flight.
    onSuccess: (saved) => {
      if (qc.isMutating({ mutationKey: key }) > 1) return;
      qc.setQueryData(key, saved);
    },
  });

  // Build the next value from the cache, not the render closure, so rapid
  // successive changes don't clobber each other's optimistic updates.
  const current = () =>
    (memberId != null ? qc.getQueryData<AnalysisScope>(key) : null) ?? EMPTY_SCOPE;
  const update = (patch: Partial<AnalysisScope>) => {
    if (memberId == null) return;
    save.mutate({ ...current(), ...patch });
  };

  return {
    scope,
    update,
    toggleSprint: (id: number) => update({ sprint_ids: toggled(current().sprint_ids, id) }),
    toggleRepo: (id: number) => update({ repo_ids: toggled(current().repo_ids, id) }),
    reset: () => {
      if (memberId != null) save.mutate(EMPTY_SCOPE);
    },
  };
}
