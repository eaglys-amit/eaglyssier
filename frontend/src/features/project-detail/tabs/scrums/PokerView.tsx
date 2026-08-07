import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, RotateCcw, Spade, UserCircle2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { PokerSession, PokerSessionDetail, PokerStats } from "@/types/api";

import { PokerDeck } from "./PokerDeck";
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

  const { data: sessions, isPending } = useQuery({
    queryKey: qk.pokerSessions(projectId),
    queryFn: () => api.get<PokerSession[]>(`/projects/${projectId}/poker`),
  });

  const open = sessions?.find((s) => s.status === "open") ?? null;
  const sessionId = activeId ?? open?.id ?? null;

  const start = useMutation({
    mutationFn: () =>
      api.post<PokerSession>(`/projects/${projectId}/poker`, { sprint_id: sprintId }),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: qk.pokerSessions(projectId) });
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
    return (
      <EmptyState
        icon={Spade}
        title="No estimation session running"
        hint={
          sprintId
            ? "Start one to queue up every unestimated task in the selected sprint."
            : "Start one to queue up every unestimated task in the project."
        }
        action={
          <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
            <Spade className="size-4" />
            {start.isPending ? "Starting…" : "Start a session"}
          </Button>
        }
      />
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
  const { session, isPending, vote, reveal, revote, apply, close } = usePokerSession(
    projectId,
    sessionId,
    meId,
  );

  if (isPending || !session) return <TableSkeleton rows={6} />;

  const round = session.current_round;
  const myVote = round?.votes.find((v) => v.member_id === meId) ?? null;
  const voting = round?.status === "voting";
  const voted = round?.votes.length ?? 0;

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
        <EmptyState
          icon={CheckCircle2}
          title="Everything queued has been estimated"
          hint="Close the session, or queue more tasks from the board."
        />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{round.task_key}</span>
                <span className="truncate">{round.task_title}</span>
                {round.attempt > 1 ? (
                  <Badge variant="outline">Round {round.attempt}</Badge>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {voted}/{session.participants.length} voted
                </span>
                {voting ? (
                  <Button size="sm" variant="outline" onClick={() => reveal.mutate(round.id)}>
                    <Eye className="size-4" /> Reveal
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => revote.mutate(round.id)}>
                    <RotateCcw className="size-4" /> Re-vote
                  </Button>
                )}
              </span>
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
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
                deck={session.deck}
                busy={apply.isPending}
                onAccept={(points) =>
                  apply.mutate({ roundId: round.id, body: { points } })
                }
              />
            ) : null}
          </CardContent>
        </Card>
      )}

      <Queue session={session} />
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
  deck,
  busy,
  onAccept,
}: {
  stats: PokerStats;
  deck: number[];
  busy: boolean;
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
        <Button
          size="sm"
          disabled={choice == null || busy}
          onClick={() => choice != null && onAccept(choice)}
        >
          {busy ? "Saving…" : "Accept estimate"}
        </Button>
        {!stats.consensus ? (
          <span className="text-xs text-muted-foreground">
            Suggested {formatPoints(stats.suggested)} — the median rounded up to a real card.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Queue({ session }: { session: PokerSessionDetail }) {
  if (!session.queue.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-tight text-muted-foreground uppercase">
        Queue
      </h3>
      <div className="divide-y rounded-lg border bg-card">
        {session.queue.map((item) => (
          <div key={item.task_id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
              {item.task_key}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.task_title}</span>
            {item.attempts > 1 ? (
              <Badge variant="outline" className="text-[10px]">
                {item.attempts} rounds
              </Badge>
            ) : null}
            {item.round_status === "applied" ? (
              <span className="font-mono text-xs tabular-nums text-success">
                {formatPoints(item.story_points)} pts
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {item.round_status === "revealed" ? "revealed" : "pending"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
