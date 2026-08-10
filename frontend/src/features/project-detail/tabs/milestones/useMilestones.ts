import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type {
  GeneratePreview,
  GenerateResult,
  Milestone,
  MilestoneCreateIn,
  MilestonePatchIn,
  Task,
} from "@/types/api";

/**
 * The Milestones tab's data layer, shared by the list view and the sheet.
 *
 * Every write invalidates the milestone subtree *and* the board: linking a task
 * changes what the Scrums commitment meter is counting, and unlinking changes
 * it back. The reverse wiring lives in useBoard.invalidateAll().
 */
export function useMilestones(projectId: number) {
  const qc = useQueryClient();
  const key = qk.milestones(projectId);

  const milestones = useQuery({
    queryKey: key,
    queryFn: () => api.get<Milestone[]>(`/projects/${projectId}/milestones`),
    enabled: Number.isFinite(projectId),
  });

  /** Prefix key: sweeps the list, the roadmap, and every per-milestone task list. */
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: qk.board(projectId) });
  };

  const createMilestone = useMutation({
    mutationFn: (body: MilestoneCreateIn) =>
      api.post<Milestone>(`/projects/${projectId}/milestones`, body),
    onSuccess: (m) => {
      invalidateAll();
      toast.success(`Created ${m.name}`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not create the milestone"),
  });

  const patchMilestone = useMutation({
    mutationFn: ({ milestoneId, body }: { milestoneId: number; body: MilestonePatchIn }) =>
      api.patch<Milestone>(`/projects/${projectId}/milestones/${milestoneId}`, body),
    onSuccess: () => invalidateAll(),
    onError: (err: ApiError) => toast.error(err.detail || "Could not save the milestone"),
  });

  const deleteMilestone = useMutation({
    mutationFn: (milestoneId: number) =>
      api.delete(`/projects/${projectId}/milestones/${milestoneId}`),
    onSuccess: () => {
      invalidateAll();
      toast.success("Milestone deleted. Its tasks are still there, just unlinked.");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete the milestone"),
  });

  const linkTasks = useMutation({
    mutationFn: ({ milestoneId, taskIds }: { milestoneId: number; taskIds: number[] }) =>
      api.post<Task[]>(`/projects/${projectId}/milestones/${milestoneId}/tasks`, {
        task_ids: taskIds,
      }),
    onSuccess: (_tasks, { taskIds }) => {
      invalidateAll();
      toast.success(`Linked ${taskIds.length} ${taskIds.length === 1 ? "task" : "tasks"}`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not link the tasks"),
  });

  const unlinkTask = useMutation({
    mutationFn: ({ milestoneId, taskId }: { milestoneId: number; taskId: number }) =>
      api.delete(`/projects/${projectId}/milestones/${milestoneId}/tasks/${taskId}`),
    onSuccess: () => invalidateAll(),
    onError: (err: ApiError) => toast.error(err.detail || "Could not unlink the task"),
  });

  const generate = useMutation({
    mutationFn: (sourceTaskIds: number[] | null) =>
      api.post<GenerateResult>(`/projects/${projectId}/milestones/generate`, {
        source_task_ids: sourceTaskIds,
      }),
    onSuccess: (result) => {
      invalidateAll();
      const parts = [];
      if (result.created) parts.push(`${result.created} created`);
      if (result.updated) parts.push(`${result.updated} topped up`);
      parts.push(`${result.linked} ${result.linked === 1 ? "task" : "tasks"} linked`);
      toast.success(parts.join(" · "));
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not generate milestones"),
  });

  return {
    milestones: milestones.data ?? [],
    isPending: milestones.isPending,
    isFetching: milestones.isFetching,
    error: milestones.error,
    createMilestone,
    patchMilestone,
    deleteMilestone,
    linkTasks,
    unlinkTask,
    generate,
  };
}

/**
 * Dry run of the generator. Enabled only while the dialog is open — it is a
 * whole-project scan, and there is nothing to show when nobody is looking.
 */
export function useGeneratePreview(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.generatePreview(projectId),
    queryFn: () =>
      api.get<GeneratePreview>(`/projects/${projectId}/milestones/generate/preview`),
    enabled: enabled && Number.isFinite(projectId),
  });
}

/** The tasks linked to one milestone — containers included, for the sheet. */
export function useMilestoneTasks(projectId: number, milestoneId: number | null) {
  return useQuery({
    queryKey: qk.milestoneTasks(projectId, milestoneId ?? 0),
    queryFn: () =>
      api.get<Task[]>(`/projects/${projectId}/milestones/${milestoneId}/tasks`),
    enabled: Number.isFinite(projectId) && milestoneId !== null,
  });
}
