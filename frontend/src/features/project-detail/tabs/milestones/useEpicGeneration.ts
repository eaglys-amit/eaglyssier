import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type {
  EpicGenerateResult,
  EpicNameables,
  EpicNames,
  EpicPreview,
  EpicRenameResult,
} from "@/types/api";

/**
 * Epic generation: rebuilds the backlog tree from the team's own task
 * numbering, so the milestone generator has something to group.
 *
 * A write here re-parents tasks, which changes the board, the breakdown tree,
 * capacity and every milestone rollup — so it sweeps the whole project subtree
 * rather than trying to be surgical.
 */
export function useEpicGeneration(projectId: number, previewEnabled: boolean) {
  const qc = useQueryClient();

  const preview = useQuery({
    queryKey: qk.epicPreview(projectId),
    queryFn: () =>
      api.get<EpicPreview>(`/projects/${projectId}/epics/generate/preview`),
    enabled: previewEnabled && Number.isFinite(projectId),
  });

  const generate = useMutation({
    mutationFn: ({
      groupKeys,
      names,
    }: {
      groupKeys: string[] | null;
      names?: Record<string, string>;
    }) =>
      api.post<EpicGenerateResult>(`/projects/${projectId}/epics/generate`, {
        group_keys: groupKeys,
        names: names ?? null,
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: qk.project(projectId) });
      const parts: string[] = [];
      if (result.created) parts.push(`${result.created} epics created`);
      if (result.updated) parts.push(`${result.updated} topped up`);
      parts.push(`${result.grouped} tasks grouped`);
      toast.success(parts.join(" · "));
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not generate epics"),
  });

  return { preview, generate };
}

/**
 * Naming, kept separate from grouping on purpose.
 *
 * The model only ever proposes a *label*; membership is decided by the
 * deterministic parse. So a bad suggestion costs a worse name that the user can
 * type over — never a wrong epic.
 */
export function useEpicNaming(projectId: number, enabled: boolean) {
  const qc = useQueryClient();

  const nameable = useQuery({
    queryKey: [...qk.epicPreview(projectId), "nameable"],
    queryFn: () => api.get<EpicNameables>(`/projects/${projectId}/epics/nameable`),
    enabled: enabled && Number.isFinite(projectId),
  });

  const suggest = useMutation({
    mutationFn: () =>
      api.post<EpicNames>(`/projects/${projectId}/epics/generate/names`),
    onError: (err: ApiError) =>
      toast.error(err.detail || "Could not suggest names — edit them by hand instead"),
  });

  const rename = useMutation({
    mutationFn: (names: Record<string, string>) =>
      api.post<EpicRenameResult>(`/projects/${projectId}/epics/rename`, { names }),
    onSuccess: (result) => {
      // Epic titles become milestone names, so the whole project subtree moves.
      qc.invalidateQueries({ queryKey: qk.project(projectId) });
      toast.success(
        result.renamed
          ? `Renamed ${result.renamed} ${result.renamed === 1 ? "epic" : "epics"}`
          : "No names changed",
      );
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not rename the epics"),
  });

  return { nameable, suggest, rename };
}
