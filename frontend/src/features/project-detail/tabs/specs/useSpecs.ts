import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type {
  RequirementBrief,
  RequirementKind,
  RequirementPriority,
  SpecDetail,
  SpecSource,
  SpecSummary,
  Task,
  TaskRequirement,
} from "@/types/api";

const running = (s?: { extract_status: string }) => s?.extract_status === "running";

export function useSpecList(projectId: number) {
  return useQuery({
    queryKey: qk.specs(projectId),
    queryFn: () => api.get<SpecSummary[]>(`/projects/${projectId}/specs`),
    refetchInterval: (q) => (q.state.data?.some(running) ? 2000 : false),
  });
}

export function useSpec(specId: number | null) {
  return useQuery({
    queryKey: qk.spec(specId ?? 0),
    queryFn: () => api.get<SpecDetail>(`/specs/${specId}`),
    enabled: specId !== null,
    refetchInterval: (q) => (running(q.state.data) ? 2000 : false),
  });
}

export function useSpecSources(projectId: number) {
  return useQuery({
    queryKey: qk.specSources(projectId),
    queryFn: () => api.get<SpecSource[]>(`/projects/${projectId}/spec-sources`),
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.spec_sync_status === "running") ? 2000 : false,
  });
}

export function useProjectTasks(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.tasks(projectId),
    queryFn: () => api.get<Task[]>(`/projects/${projectId}/tasks`),
    enabled,
  });
}

export function useProjectRequirements(projectId: number, enabled = true) {
  return useQuery({
    queryKey: qk.projectRequirements(projectId),
    queryFn: () => api.get<RequirementBrief[]>(`/projects/${projectId}/requirements`),
    enabled,
  });
}

export function useTaskRequirements(taskId: number, enabled = true) {
  return useQuery({
    queryKey: qk.taskRequirements(taskId),
    queryFn: () => api.get<TaskRequirement[]>(`/tasks/${taskId}/requirements`),
    enabled,
  });
}

export interface RequirementDraft {
  key?: string | null;
  title: string;
  statement: string;
  kind: RequirementKind;
  priority: RequirementPriority | null;
  acceptance_criteria: string[];
}

/** Every write the Specs tab and the task sheet make, with one refresh rule. */
export function useSpecMutations(projectId: number, specId?: number | null) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.specs(projectId) });
    qc.invalidateQueries({ queryKey: qk.projectRequirements(projectId) });
    qc.invalidateQueries({ queryKey: qk.specSources(projectId) });
    // Every open spec detail and every task sheet's requirement list: a link or
    // an edit shows up in both, and they're cheap to refetch.
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "specs" });
    qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "tasks" && q.queryKey[2] === "requirements",
    });
  };
  const fail = (fallback: string) => (err: ApiError) => toast.error(err.detail || fallback);

  return {
    setSource: useMutation({
      mutationFn: ({ repoId, enabled, specPath }: { repoId: number; enabled: boolean; specPath: string }) =>
        api.put<SpecSource>(`/repos/${repoId}/spec-source`, { enabled, spec_path: specPath }),
      onSuccess: (s) => {
        refresh();
        toast.success(s.spec_sync_enabled ? `Reading specs from ${s.name}` : `Stopped syncing ${s.name}`);
      },
      onError: fail("Could not change the spec source"),
    }),
    syncSource: useMutation({
      mutationFn: (repoId: number) => api.post<SpecSource>(`/repos/${repoId}/specs/sync`),
      onSuccess: () => refresh(),
      onError: fail("Could not start the spec sync"),
    }),
    create: useMutation({
      mutationFn: (body: { reference_file_id: number; title: string | null }) =>
        api.post<SpecDetail>(`/projects/${projectId}/specs`, body),
      onSuccess: () => {
        refresh();
        toast.success("Spec created — reading its requirements");
      },
      onError: fail("Could not create the spec"),
    }),
    patch: useMutation({
      mutationFn: (body: { title?: string; status?: "draft" | "approved" }) =>
        api.patch<SpecDetail>(`/specs/${specId}`, body),
      onSuccess: () => refresh(),
      onError: fail("Could not update the spec"),
    }),
    remove: useMutation({
      mutationFn: () => api.delete(`/specs/${specId}`),
      onSuccess: () => {
        refresh();
        toast.success("Spec removed (its document stays in Documents)");
      },
      onError: fail("Could not remove the spec"),
    }),
    reExtract: useMutation({
      mutationFn: () => api.post<SpecDetail>(`/specs/${specId}/extract`),
      onSuccess: () => refresh(),
      onError: fail("Could not start extraction"),
    }),
    uploadVersion: useMutation({
      mutationFn: (file: File) => {
        const form = new FormData();
        form.append("file", file);
        return api.upload<SpecDetail>(`/specs/${specId}/versions`, form);
      },
      onSuccess: () => {
        refresh();
        toast.success("New version uploaded — comparing its requirements");
      },
      onError: fail("Could not upload the new version"),
    }),
    addRequirement: useMutation({
      mutationFn: (body: RequirementDraft) =>
        api.post<SpecDetail>(`/specs/${specId}/requirements`, body),
      onSuccess: () => refresh(),
      onError: fail("Could not add the requirement"),
    }),
    patchRequirement: useMutation({
      mutationFn: ({ id, body }: { id: number; body: Partial<RequirementDraft> & { clear_priority?: boolean } }) =>
        api.patch(`/requirements/${id}`, body),
      onSuccess: () => refresh(),
      onError: fail("Could not save the requirement"),
    }),
    deleteRequirement: useMutation({
      mutationFn: (id: number) => api.delete(`/requirements/${id}`),
      onSuccess: () => refresh(),
      onError: fail("Could not delete the requirement"),
    }),
    link: useMutation({
      mutationFn: ({ requirementId, taskId }: { requirementId: number; taskId: number }) =>
        api.post(`/requirements/${requirementId}/tasks`, { task_id: taskId }),
      onSuccess: () => refresh(),
      onError: fail("Could not link the task"),
    }),
    unlink: useMutation({
      mutationFn: ({ requirementId, taskId }: { requirementId: number; taskId: number }) =>
        api.delete(`/requirements/${requirementId}/tasks/${taskId}`),
      onSuccess: () => refresh(),
      onError: fail("Could not unlink the task"),
    }),
    reviewed: useMutation({
      mutationFn: ({ requirementId, taskId }: { requirementId: number; taskId: number }) =>
        api.post(`/requirements/${requirementId}/tasks/${taskId}/reviewed`),
      onSuccess: () => refresh(),
      onError: fail("Could not clear the review flag"),
    }),
  };
}
