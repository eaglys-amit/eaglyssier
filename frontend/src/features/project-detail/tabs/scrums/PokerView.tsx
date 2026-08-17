import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Eye,
  Play,
  RotateCcw,
  Spade,
  Sparkles,
  UserCircle2,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { formatPoints } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type {
  PokerCandidates,
  PokerRound,
  PokerSession,
  PokerSessionDetail,
  PokerStats,
} from "@/types/api";

import { PokerDeck } from "./PokerDeck";
import { PokerQueue } from "./PokerQueue";
import { usePokerMe } from "./usePokerMe";
import { usePokerSession } from "./usePokerSession";
import { VoteGrid } from "./VoteGrid";

/**
 * Planning poker: everyone picks a card, the values stay hidden until someone
 * reveals, the room agrees a number, and it lands on the task.
 *
 * There's no auth, so the first thing this asks is who you are — see
 * usePokerMe. Votes are therefore advisory; that's fine for a team in a room,
 * and it's stated in the UI rather than pretended away.
 */
export function PokerView({
  projectId,
  sprintId,
}: {
  projectId: number;
  sprintId: number | null;
}) {
  const qc = useQueryClient();
  const { me, candidates, choose, membersLoaded } = usePokerMe(projectId);
  const [activeId, setActiveId] = useState<number | null>(null);
  // Off by default: estimating happens before planning, so the unplanned
  // backlog is the natural queue. Pulling in every sprint as well turns a
  // refinement session into a re-litigation of work already underway.
  const [includeSprintTasks, setIncludeSprintTasks] = useState(false);
  // On by default when there are any: an AI proposal that nobody challenged is
  // the single most likely wrong number in the backlog.
  const [includeProposed, setIncludeProposed] = useState(true);

  const { data: queue } = useQuery({
    queryKey: qk.pokerCandidates(projectId),
    queryFn: () => api.get<PokerCandidates>(`/projects/${projectId}/poker/candidates`),
  });

  const { data: sessions, isPending } = useQuery({
    queryKey: qk.pokerSessions(projectId),
    queryFn: () => api.get<PokerSession[]>(`/projects/${projectId}/poker`),
  });

  const open = sessions?.find((s) => s.status === "open") ?? null;
  const sessionId = activeId ?? open?.id ?? null;

  const start = useMutation({
    mutationFn: () =>
      api.post<PokerSession>(`/projects/${projectId}/poker`, {
        // Whoever starts it facilitates it.
        facilitator_member_id: me?.id ?? null,
        sprint_id: sprintId,
        include_sprint_tasks: includeSprintTasks,
        include_proposed: includeProposed,
      }),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: qk.pokerSessions(projectId) });
      qc.invalidateQueries({ queryKey: qk.pokerCandidates(projectId) });
      setActiveId(session.id);
      toast.success(`${session.name} — ${session.queued} tasks queued`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start a session"),
  });

  if (isPending || !membersLoaded) return <TableSkeleton rows={6} />;

  if (!candidates.length) {
    return (
      <EmptyState
        icon={UserCircle2}
        title="No members on this project yet"
        hint="Poker needs people to vote. Add them on the project's Members page."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to={`/projects/${projectId}/members`}>Go to Members</Link>
          </Button>
        }
      />
    );
  }

  if (!me) {
    return <MemberGate candidates={candidates} onChoose={choose} />;
  }

  if (sessionId == null) {
    const backlogCount = queue?.backlog.length ?? 0;
    const sprintCount = queue?.in_sprints.length ?? 0;
    const proposedCount = queue?.proposed.length ?? 0;
    const total =
      backlogCount +
      (includeSprintTasks ? sprintCount : 0) +
      (includeProposed ? proposedCount : 0);

    return (
      <div className="mx-auto max-w-lg py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start an estimation session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The queue is the <strong>unplanned backlog</strong> — the work that still needs a
              number before it can be planned into a sprint.
            </p>

            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Backlog, unestimated</span>
                <span className="font-mono tabular-nums">{backlogCount}</span>
              </div>
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={includeSprintTasks}
                  onCheckedChange={(v) => setIncludeSprintTasks(v === true)}
                  className="mt-0.5"
                  disabled={!sprintCount}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span>Also unestimated To Do already in a sprint</span>
                    <span className="font-mono tabular-nums">{sprintCount}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Carried-over tickets that never got a number. Work in progress or done is
                    never included — estimating it after the fact tells you nothing.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={includeProposed}
                  onCheckedChange={(v) => setIncludeProposed(v === true)}
                  className="mt-0.5"
                  disabled={!proposedCount}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span>Re-estimate AI proposals</span>
                    <span className="font-mono tabular-nums">{proposedCount}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Tasks a breakdown gave points to that nobody agreed. They look
                    estimated, so nothing else surfaces them. The model's number stays
                    hidden until the reveal, so it can't anchor the vote.
                  </span>
                </span>
              </label>
            </div>

            {/* Containers are excluded everywhere; saying so here saves the
                "why is my epic missing" question. */}
            <p className="text-xs text-muted-foreground">
              Epics and other parent tasks are left out: their points roll up from their
              children, so estimating them would count the same work twice.
            </p>

            <Button
              size="sm"
              disabled={!total || start.isPending}
              onClick={() => start.mutate()}
            >
              <Spade className="size-4" />
              {start.isPending
                ? "Starting…"
                : total
                  ? `Estimate ${total} ${total === 1 ? "task" : "tasks"}`
                  : "Nothing to estimate"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ActiveSession
      projectId={projectId}
      sessionId={sessionId}
      meId={me.id}
      meName={me.display_name}
      onChangeMe={() => choose(null)}
      onLeave={() => setActiveId(null)}
    />
  );
}

function MemberGate({
  candidates,
  onChoose,
}: {
  candidates: { id: number; display_name: string }[];
  onChoose: (id: number) => void;
}) {
  return (
    <div className="mx-auto max-w-sm py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who are you?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This tool has no accounts, so pick yourself from the project's members. The choice
            is remembered in this browser.
          </p>
          <Select onValueChange={(v) => onChoose(Number(v))}>
            <SelectTrigger>
              <SelectValue placeholder="Pick your name" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}

function ActiveSession({
  projectId,
  sessionId,
  meId,
  meName,
  onChangeMe,
  onLeave,
}: {
  projectId: number;
  sessionId: number;
  meId: number;
  meName: string;
  onChangeMe: () => void;
  onLeave: () => void;
}) {
  const {
    session,
    isPending,
    vote,
    reveal,
    takeOver,
    revote,
    apply,
    selectTask,
    moveQueue,
    close,
  } = usePokerSession(projectId, sessionId, meId);

  if (isPending || !session) return <TableSkeleton rows={6} />;

  const round = session.current_round;
  const myVote = round?.votes.find((v) => v.member_id === meId) ?? null;
  const voting = round?.status === "voting";
  const voted = round?.votes.length ?? 0;
  // Still estimable, in queue order — so "the next one" means the same thing
  // here as it does in the list below.
  const remaining = session.queue.filter((q) => q.round_status !== "applied");
  const next = remaining[0] ?? null;
  // No facilitator (a pre-lock session, or theirs was deleted) falls back to
  // letting anyone act, rather than leaving a room that can never turn the
  // cards over or record what it agreed. Gates both the reveal and the decision;
  // the server enforces the same rule on both.
  const isHost =
    session.facilitator_member_id == null || session.facilitator_member_id === meId;

  return (
    <div className="space-y-4">
      <SessionHeader
        session={session}
        meName={meName}
        onChangeMe={onChangeMe}
        onLeave={onLeave}
        onClose={() => close.mutate()}
        closing={close.isPending}
      />

      {!round ? (
        remaining.length ? (
          // Not an error state: this is the gap between finishing one estimate
          // and the room agreeing what to pick up next.
          <EmptyState
            icon={Spade}
            title="Nothing on the table"
            hint={
              isHost
                ? "Pick a task from the queue below to put it in front of the room."
                : `${session.facilitator_name ?? "The facilitator"} chooses what the room estimates next.`
            }
            action={
              isHost && next ? (
                <Button
                  size="sm"
                  disabled={selectTask.isPending}
                  onClick={() => selectTask.mutate(next.task_id)}
                >
                  <Play className="size-4" />
                  Estimate {next.task_key ?? "the next task"}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="Everything queued has been estimated"
            hint="Close the session, or queue more tasks from the board."
          />
        )
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{round.task_key}</span>
                {/* Not truncated: this is the thing being estimated. */}
                <span className="min-w-0">{round.task_title}</span>
                {round.task_issue_type ? (
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    {round.task_issue_type}
                  </Badge>
                ) : null}
                {round.attempt > 1 ? (
                  <Badge variant="outline">Round {round.attempt}</Badge>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {voted}/{session.participants.length} voted
                </span>
                {voting ? (
                  isHost ? (
                    <Button size="sm" variant="outline" onClick={() => reveal.mutate(round.id)}>
                      <Eye className="size-4" /> Reveal
                    </Button>
                  ) : (
                    // Not a disabled button: the room should know who they're
                    // waiting on, and have a way out if that person has gone.
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Eye className="size-3.5" />
                      {session.facilitator_name ?? "The facilitator"} reveals
                      <Button
                        variant="link"
                        size="xs"
                        className="h-auto p-0 text-xs"
                        onClick={() => takeOver.mutate()}
                      >
                        take over
                      </Button>
                    </span>
                  )
                ) : (
                  <Button size="sm" variant="outline" onClick={() => revote.mutate(round.id)}>
                    <RotateCcw className="size-4" /> Re-vote
                  </Button>
                )}
              </span>
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <TaskContext round={round} />

            <PokerDeck
              deck={session.deck}
              breakdownPoints={session.breakdown_points}
              selected={myVote?.points ?? null}
              abstained={myVote?.abstain === true}
              disabled={!voting || session.status === "closed"}
              onPick={(points, abstain) =>
                vote.mutate({ member_id: meId, points, abstain })
              }
            />

            <VoteGrid round={round} participants={session.participants} meId={meId} />

            {!voting && round.stats ? (
              <Consensus
                key={`${round.id}-${round.attempt}`}
                stats={round.stats}
                proposed={round.proposed_points}
                deck={session.deck}
                busy={apply.isPending}
                isHost={isHost}
                facilitatorName={session.facilitator_name}
                onAccept={(points) =>
                  apply.mutate({ roundId: round.id, body: { points } })
                }
              />
            ) : null}
          </CardContent>
        </Card>
      )}

      <PokerQueue
        session={session}
        isHost={isHost}
        busy={moveQueue.isPending || selectTask.isPending}
        onMove={(taskId, afterTaskId) =>
          moveQueue.mutate({ task_id: taskId, after_task_id: afterTaskId })
        }
        onSelect={(taskId) => selectTask.mutate(taskId)}
      />
    </div>
  );
}

function SessionHeader({
  session,
  meName,
  onChangeMe,
  onLeave,
  onClose,
  closing,
}: {
  session: PokerSessionDetail;
  meName: string;
  onChangeMe: () => void;
  onLeave: () => void;
  onClose: () => void;
  closing: boolean;
}) {
  const live = session.status === "open";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="truncate text-sm font-semibold tracking-tight">{session.name}</h2>
        {/* A static dot, not a spinner: something that blinks every 2s reads as
            a bug rather than as liveness. */}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              live ? "animate-pulse bg-success" : "bg-muted-foreground",
            )}
          />
          {live ? "Live" : "Closed"}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {session.estimated}/{session.queued} estimated
        </span>
        {session.facilitator_name ? (
          <span className="text-xs text-muted-foreground">
            {session.facilitator_name} facilitating
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="xs" onClick={onChangeMe}>
          <UserCircle2 className="size-3.5" />
          You are {meName} — change
        </Button>
        {live ? (
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="xs">
                Close session
              </Button>
            }
            title={`Close ${session.name}?`}
            description="Estimates already applied are kept. Anything unestimated stays unestimated."
            confirmLabel="Close session"
            destructive={false}
            onConfirm={onClose}
          />
        ) : (
          <Button variant="ghost" size="xs" onClick={onLeave} disabled={closing}>
            Back to sessions
          </Button>
        )}
      </div>
    </div>
  );
}

function Consensus({
  stats,
  proposed,
  deck,
  busy,
  isHost,
  facilitatorName,
  onAccept,
}: {
  stats: PokerStats;
  /** The AI's number, revealed only now so it couldn't anchor the vote. */
  proposed: number | null;
  deck: number[];
  busy: boolean;
  /** Only the facilitator picks the number and commits it. */
  isHost: boolean;
  facilitatorName: string | null;
  onAccept: (points: number) => void;
}) {
  // Seeded from the suggestion but overridable — the room's decision wins over
  // the arithmetic. Remounted per round (Consensus only renders once revealed),
  // so the seed is fresh each time.
  const [choice, setChoice] = useState<number | null>(stats.suggested ?? null);

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {stats.consensus ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <CheckCircle2 className="size-4" /> Everyone agreed
          </span>
        ) : (
          <span className="font-mono tabular-nums text-muted-foreground">
            spread {formatPoints(stats.low)}–{formatPoints(stats.high)} · median{" "}
            {formatPoints(stats.median)}
          </span>
        )}
        {stats.abstains > 0 ? (
          <span className="text-xs text-muted-foreground">
            {stats.abstains} unsure (not counted)
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Record as</span>
        {isHost ? (
          <Select
            value={choice != null ? String(choice) : undefined}
            onValueChange={(v) => setChoice(Number(v))}
          >
            <SelectTrigger size="sm" className="w-24">
              <SelectValue placeholder="pts" />
            </SelectTrigger>
            <SelectContent>
              {deck.map((p) => (
                <SelectItem key={p} value={String(p)}>
                  {formatPoints(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // Deliberately not a disabled Select: the host's dropdown is local
          // state that never goes over the wire, so a mirrored control would be
          // lying about what they currently have picked. This shows the
          // suggestion the room is deciding from, and says who commits it.
          <span className="rounded-md border bg-background px-2 py-1 font-mono text-sm tabular-nums">
            {formatPoints(stats.suggested)}
          </span>
        )}

        {/* Sits next to the number being recorded, so the two are read together
            in the moment the decision is made — but only after the reveal, which
            is what keeps it from anchoring the vote itself. */}
        {proposed != null ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <Sparkles className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">AI proposed</span>
            <span className="font-mono tabular-nums">{formatPoints(proposed)}</span>
            {stats.median != null ? (
              <span className={stats.median === proposed ? "text-success" : "text-warning"}>
                {stats.median === proposed
                  ? "— the room agrees"
                  : `— the room landed on ${formatPoints(stats.median)}`}
              </span>
            ) : null}
          </span>
        ) : null}

        {isHost ? (
          <Button
            size="sm"
            disabled={choice == null || busy}
            onClick={() => choice != null && onAccept(choice)}
          >
            {busy ? "Saving…" : "Accept estimate"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {facilitatorName ?? "The facilitator"} records the estimate
          </span>
        )}

        {isHost && !stats.consensus ? (
          <span className="text-xs text-muted-foreground">
            Suggested {formatPoints(stats.suggested)} — the median rounded up to a real card.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What the room needs in front of them to put a number on this task.
 *
 * A key and a title aren't estimable — engineers need the scope and what
 * "done" means. Shown above the deck so it's read before a card is picked,
 * with a way through to the full task for anything not summarised here.
 */
function TaskContext({ round }: { round: PokerRound }) {
  const [, setParams] = useSearchParams();
  const hasContext = Boolean(round.task_description || round.task_acceptance_criteria);

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      {round.task_description ? (
        <p className="text-sm whitespace-pre-wrap">{round.task_description}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          This task has no description — worth adding one before estimating it.
        </p>
      )}

      {round.task_acceptance_criteria ? (
        <div className="mt-2.5 border-t pt-2.5">
          <div className="mb-1 text-xs font-medium text-muted-foreground uppercase">
            Acceptance criteria
          </div>
          <p className="text-sm whitespace-pre-wrap">{round.task_acceptance_criteria}</p>
        </div>
      ) : null}

      <Button
        variant="link"
        size="xs"
        className="mt-1 h-auto p-0 text-xs"
        onClick={() =>
          setParams((p) => {
            const next = new URLSearchParams(p);
            next.set("task", String(round.task_id));
            return next;
          })
        }
      >
        {hasContext ? "Open the full task" : "Open the task to add detail"}
      </Button>
    </div>
  );
}
