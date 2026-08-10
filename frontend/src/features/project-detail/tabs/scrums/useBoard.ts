import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type {
  BacklogBoard,
  BulkMoveIn,
  RankMoveIn,
  Task,
  TaskCreateIn,
  TaskPatchIn,
} from "@/types/api";

/**
 * The board's data layer: one query for everything, mutations that invalidate it.
 *
 * Deliberately NOT polled. A scrum board is not a realtime surface, and a 2s
 * refetch during a drag makes rows jump under the cursor; window-focus refetch
 * plus post-mutation invalidation is enough.
 */
export function useBoard(projectId: number) {
  const qc = useQueryClient();
  const key = qk.board(projectId);

  const board = useQuery({
    queryKey: key,
    queryFn: () => api.get<BacklogBoard>(`/projects/${projectId}/backlog-board`),
    enabled: Number.isFinite(projectId),
  });

  /** A write touched sprints or tasks, so every derived view is now stale. */
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: qk.tasks(projectId) });
    qc.invalidateQueries({ queryKey: qk.sprints(projectId) });
    qc.invalidateQueries({ queryKey: qk.taskTree(projectId) });
    qc.invalidateQueries({ queryKey: qk.capacity(projectId) });
    // Milestones roll up these same tasks and derive their sprints from them,
    // so a drag here moves the roadmap. Prefix key — sweeps roadmap and the
    // per-milestone task lists too.
    qc.invalidateQueries({ queryKey: qk.milestones(projectId) });
    // Gantt and commitment are keyed deeper than the board; sweep by prefix.
    qc.invalidateQueries({ queryKey: qk.gantt(projectId) });
    qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "projects" &&
        q.queryKey[1] === projectId &&
        q.queryKey[2] === "scrums",
    });
  };

  const createTask = useMutation({
    mutationFn: (body: TaskCreateIn) => api.post<Task>(`/projects/${projectId}/tasks`, body),
    onSuccess: (task) => {
      invalidateAll();
      toast.success(`Created ${task.external_key ?? `#${task.id}`}`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not create the task"),
  });

  const createSubtask = useMutation({
    mutationFn: ({ parentId, body }: { parentId: number; body: TaskCreateIn }) =>
      api.post<Task>(`/tasks/${parentId}/subtasks`, body),
    onSuccess: () => invalidateAll(),
    onError: (err: ApiError) => toast.error(err.detail || "Could not add the subtask"),
  });

  const patchTask = useMutation({
    mutationFn: ({ taskId, body }: { taskId: number; body: TaskPatchIn }) =>
      api.patch<Task>(`/tasks/${taskId}`, body),
    onSuccess: () => invalidateAll(),
    onError: (err: ApiError) => toast.error(err.detail || "Could not save the task"),
  });

  const deleteTask = useMutation({
    mutationFn: ({ taskId, cascade }: { taskId: number; cascade?: boolean }) =>
      api.delete(`/tasks/${taskId}${cascade ? "?cascade=true" : ""}`),
    onSuccess: () => invalidateAll(),
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete the task"),
  });

  const moveTask = useMutation({
    mutationFn: ({ taskId, body }: { taskId: number; body: RankMoveIn }) =>
      api.post<Task>(`/tasks/${taskId}/rank`, body),
    // Optimistic: a move must feel instant. The server owns the real rank, so
    // the response — not this guess — is what the next render settles on.
    onMutate: async ({ taskId, body }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BacklogBoard>(key);
      if (previous) qc.setQueryData(key, moveInBoard(previous, taskId, body));
      return { previous };
    },
    onError: (err: ApiError, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(err.detail || "Could not move the task");
    },
    onSettled: () => invalidateAll(),
  });

  const bulkMove = useMutation({
    mutationFn: (body: BulkMoveIn) =>
      api.post<Task[]>(`/projects/${projectId}/tasks/bulk-move`, body),
    onSuccess: (moved) => {
      invalidateAll();
      toast.success(`Moved ${moved.length} ${moved.length === 1 ? "task" : "tasks"}`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not move the tasks"),
  });

  return {
    board: board.data,
    isPending: board.isPending,
    error: board.error,
    createTask,
    createSubtask,
    patchTask,
    deleteTask,
    moveTask,
    bulkMove,
    invalidateAll,
  };
}

/**
 * Apply a positional move to a cached board, for the optimistic update.
 *
 * Pure and total: it re-buckets the task and splices it after the anchor, but
 * never invents a rank — ordering within a bucket is array order here, and the
 * server's response replaces the whole payload a moment later.
 */
export function moveInBoard(
  board: BacklogBoard,
  taskId: number,
  { sprint_id, after_task_id }: RankMoveIn,
): BacklogBoard {
  const all = [...board.backlog, ...board.sprints.flatMap((s) => s.tasks)];
  const task = all.find((t) => t.id === taskId);
  if (!task) return board;

  const moved: Task = { ...task, sprint_id };
  const without = (list: Task[]) => list.filter((t) => t.id !== taskId);

  const insert = (list: Task[]): Task[] => {
    const rest = without(list);
    if (after_task_id === null) return [moved, ...rest];
    const at = rest.findIndex((t) => t.id === after_task_id);
    // Anchor not in this bucket (stale view) — append, matching the server.
    if (at === -1) return [...rest, moved];
    return [...rest.slice(0, at + 1), moved, ...rest.slice(at + 1)];
  };

  // Leaves only, matching the server: a container and its subtasks both carry
  // points, so summing both would flash a doubled total until the refetch lands.
  const containers = new Set(all.map((t) => t.parent_id).filter((id): id is number => id != null));
  const points = (list: Task[]) =>
    Math.round(
      list.reduce((sum, t) => sum + (containers.has(t.id) ? 0 : t.story_points ?? 0), 0) * 10,
    ) / 10;

  return {
    ...board,
    backlog: sprint_id === null ? insert(board.backlog) : without(board.backlog),
    backlog_points:
      sprint_id === null
        ? points(insert(board.backlog))
        : points(without(board.backlog)),
    sprints: board.sprints.map((bucket) => {
      if (bucket.sprint_id === sprint_id) {
        const tasks = insert(bucket.tasks);
        return { ...bucket, tasks, committed_points: points(tasks) };
      }
      if (bucket.tasks.some((t) => t.id === taskId)) {
        const tasks = without(bucket.tasks);
        return { ...bucket, tasks, committed_points: points(tasks) };
      }
      return bucket;
    }),
  };
}
