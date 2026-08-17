import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { formatPoints } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type {
  PokerApplyIn,
  PokerApplyOut,
  PokerQueueMoveIn,
  PokerSessionDetail,
  PokerVoteIn,
} from "@/types/api";

/**
 * The whole poker UI runs off one polled query, and every mutation writes into
 * that same cache entry. Five rules keep a 2-second poll from feeling broken:
 *
 * 1. **Your own vote is derived from the cache, never from `useState`.** Local
 *    state would fight the poll; unmutated server state would flip your card
 *    back for up to two seconds after you click. One source of truth.
 * 2. `cancelQueries` in `onMutate`, so a poll already in flight can't land
 *    after the optimistic write and revert it.
 * 3. Ignore a stale mutation response when a newer one is in flight.
 * 4. No spinner bound to `isFetching` — a spinner that blinks every two
 *    seconds *is* the flicker. The UI shows a static "Live" dot instead.
 * 5. Reveal is one atomic server transition, so values can never trickle in
 *    one poll at a time.
 */
export function usePokerSession(
  projectId: number,
  sessionId: number | null,
  meId: number | null,
) {
  const qc = useQueryClient();
  // meId is part of the key: the payload differs per voter (their own card is
  // un-redacted), so two people in one browser profile must not share a cache
  // entry.
  const key = [...qk.pokerSession(sessionId ?? 0), meId] as const;

  const session = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<PokerSessionDetail>(
        `/poker/${sessionId}${meId != null ? `?me=${meId}` : ""}`,
      ),
    enabled: sessionId != null,
    // Only poll while the session is actually open; an idle tab left on a
    // closed session shouldn't hit the API forever.
    refetchInterval: (q) => (q.state.data?.status === "open" ? 2000 : false),
    refetchIntervalInBackground: false,
  });

  /** Refresh the sibling queries a settled round changes. */
  const invalidateDerived = () => {
    qc.invalidateQueries({ queryKey: qk.pokerSessions(projectId) });
    qc.invalidateQueries({ queryKey: qk.board(projectId) });
    qc.invalidateQueries({ queryKey: qk.tasks(projectId) });
    qc.invalidateQueries({ queryKey: qk.scaleViolations(projectId) });
  };

  const vote = useMutation({
    mutationKey: key,
    mutationFn: (body: PokerVoteIn) =>
      api.post(`/poker/rounds/${currentRoundId(qc, key)}/vote`, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PokerSessionDetail>(key);
      // Mark yourself as voted immediately. Only *your* value is shown locally;
      // everyone else's stays hidden until the server reveals.
      qc.setQueryData<PokerSessionDetail>(key, (s) => (s ? withMyVote(s, body) : s));
      return { previous };
    },
    onError: (err: ApiError, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(err.detail || "Could not record your vote");
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: key }) > 1) return;
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const reveal = useMutation({
    // The server checks this against the session's facilitator and 403s anyone
    // else; the UI hides the button, but the rule lives on the server.
    mutationFn: (roundId: number) =>
      api.post(`/poker/rounds/${roundId}/reveal`, { member_id: meId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (err: ApiError) => toast.error(err.detail || "Could not reveal the votes"),
  });

  /** The escape hatch: without it, a facilitator's closed tab strands the room. */
  const takeOver = useMutation({
    mutationFn: () => api.post(`/poker/${sessionId}/facilitator`, { member_id: meId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success("You're facilitating now");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not take over"),
  });

  const revote = useMutation({
    mutationFn: (roundId: number) => api.post(`/poker/rounds/${roundId}/revote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (err: ApiError) => toast.error(err.detail || "Could not start a re-vote"),
  });

  const apply = useMutation({
    // member_id rides along so the server can enforce facilitator-only, the same
    // as reveal. The UI renders the controls read-only for everyone else.
    mutationFn: ({ roundId, body }: { roundId: number; body: PokerApplyIn }) =>
      api.post<PokerApplyOut>(`/poker/rounds/${roundId}/apply`, {
        ...body,
        member_id: meId,
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: key });
      invalidateDerived();
      // The scale's opinion is advisory, so it's a warning toast, not an error —
      // the room decided, and this is the note in the margin.
      if (result.warnings.length) {
        toast.warning(result.warnings.join(" "));
      } else {
        toast.success(`Estimated at ${formatPoints(result.story_points)} points`);
      }
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save the estimate"),
  });

  /**
   * Put a task on the table. Nothing is selected automatically, so this is how
   * every round starts — and how the room moves on after applying an estimate.
   *
   * No optimistic write: selecting swaps the whole round out (task, votes,
   * stats), and guessing that shape locally would flash a half-built round.
   * The response carries the real one, so the wait is a request, not a poll.
   */
  const selectTask = useMutation({
    mutationKey: key,
    mutationFn: (taskId: number | null) =>
      api.post<PokerSessionDetail>(
        `/poker/${sessionId}/select${meId != null ? `?me=${meId}` : ""}`,
        { task_id: taskId, member_id: meId },
      ),
    onSuccess: (detail) => qc.setQueryData(key, detail),
    onError: (err: ApiError) =>
      toast.error(err.detail || "Could not put that task on the table"),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: key }) > 1) return;
      qc.invalidateQueries({ queryKey: key });
    },
  });

  /**
   * Rearrange the queue — and therefore what the room votes on next.
   *
   * The response is the whole detail payload, so `current_round` corrects
   * itself on the mutation's own response instead of up to 2s later on the
   * poll. The optimistic write only reorders `queue`: recomputing which round
   * becomes active is the server's job, and guessing it here would mean
   * duplicating that rule in two places.
   */
  const moveQueue = useMutation({
    mutationKey: key,
    mutationFn: (body: PokerQueueMoveIn) =>
      api.post<PokerSessionDetail>(
        `/poker/${sessionId}/queue/move${meId != null ? `?me=${meId}` : ""}`,
        { ...body, member_id: meId },
      ),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PokerSessionDetail>(key);
      qc.setQueryData<PokerSessionDetail>(key, (s) => (s ? withMovedTask(s, body) : s));
      return { previous };
    },
    onError: (err: ApiError, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(err.detail || "Could not reorder the queue");
    },
    onSuccess: (detail) => qc.setQueryData(key, detail),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: key }) > 1) return;
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const close = useMutation({
    mutationFn: () => api.post(`/poker/${sessionId}/close`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      invalidateDerived();
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not close the session"),
  });

  return {
    session: session.data,
    isPending: session.isPending,
    vote,
    reveal,
    takeOver,
    revote,
    apply,
    selectTask,
    moveQueue,
    close,
  };
}

/**
 * Optimistically reposition one queue row.
 *
 * Pure, and deliberately narrow: it moves the row and nothing else. See
 * `moveQueue` for why `current_round` is left to the server.
 */
export function withMovedTask(
  session: PokerSessionDetail,
  { task_id, after_task_id }: PokerQueueMoveIn,
): PokerSessionDetail {
  const moved = session.queue.find((q) => q.task_id === task_id);
  if (!moved) return session;

  const rest = session.queue.filter((q) => q.task_id !== task_id);
  if (after_task_id === null) return { ...session, queue: [moved, ...rest] };

  const at = rest.findIndex((q) => q.task_id === after_task_id);
  // An anchor that isn't there any more (a stale drag against a refetched
  // queue) appends rather than dropping the row on the floor.
  if (at === -1) return { ...session, queue: [...rest, moved] };
  return { ...session, queue: [...rest.slice(0, at + 1), moved, ...rest.slice(at + 1)] };
}

/** The round id the cache currently considers active. */
function currentRoundId(
  qc: ReturnType<typeof useQueryClient>,
  key: readonly unknown[],
): number {
  const data = qc.getQueryData<PokerSessionDetail>(key);
  return data?.current_round?.id ?? 0;
}

/**
 * Optimistically record the caller's own card.
 *
 * Pure so it can be reasoned about on its own: it upserts one vote by member id
 * and leaves everyone else's entry exactly as the server sent it.
 */
export function withMyVote(
  session: PokerSessionDetail,
  body: PokerVoteIn,
): PokerSessionDetail {
  const round = session.current_round;
  if (!round) return session;

  const taking = body.points === null && !body.abstain;
  const others = round.votes.filter((v) => v.member_id !== body.member_id);
  const mine = {
    member_id: body.member_id,
    display_name:
      round.votes.find((v) => v.member_id === body.member_id)?.display_name ??
      session.participants.find((p) => p.member_id === body.member_id)?.display_name ??
      "You",
    voted_at: null,
    points: body.abstain ? null : body.points,
    abstain: body.abstain,
  };

  return {
    ...session,
    current_round: {
      ...round,
      votes: taking ? others : [...others, mine].sort((a, b) => a.member_id - b.member_id),
    },
    participants: session.participants.map((p) =>
      p.member_id === body.member_id ? { ...p, has_voted: !taking } : p,
    ),
  };
}
