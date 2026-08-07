import { Check, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PokerParticipant, PokerRound } from "@/types/api";

/**
 * Who's voted, and — once revealed — what they picked.
 *
 * Values are rendered only when `round.status !== "voting"`. That gate, rather
 * than the presence of the field, is what keeps a hidden vote hidden: the
 * server withholds values too, so the two agree, but the component must not
 * depend on a null to mean "secret".
 */
export function VoteGrid({
  round,
  participants,
  meId,
}: {
  round: PokerRound;
  participants: PokerParticipant[];
  meId: number | null;
}) {
  const revealed = round.status !== "voting";
  const byMember = new Map(round.votes.map((v) => [v.member_id, v]));
  // Outliers earn a marker only when there's a spread to be an outlier of.
  const spread = revealed && round.stats && !round.stats.consensus;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {participants.map((p) => {
        const vote = byMember.get(p.member_id);
        const isMe = p.member_id === meId;
        const value = vote?.abstain
          ? "?"
          : vote?.points != null
            ? formatPoints(vote.points)
            : null;
        const extreme =
          spread &&
          vote?.points != null &&
          (vote.points === round.stats!.low || vote.points === round.stats!.high);

        return (
          <div
            key={p.member_id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-2",
              isMe ? "border-primary/40 bg-primary/5" : "bg-card",
            )}
          >
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-md border font-mono text-base tabular-nums",
                !vote
                  ? "border-dashed text-muted-foreground/40"
                  : revealed
                    ? extreme
                      ? "border-warning/60 bg-warning/10 text-warning"
                      : "bg-muted"
                    : "border-primary/40 bg-primary/10",
              )}
            >
              {!vote ? (
                "–"
              ) : revealed ? (
                vote.abstain ? (
                  <HelpCircle className="size-4" />
                ) : (
                  value
                )
              ) : isMe && value ? (
                // Your own card is safe to show back to you before the reveal —
                // the server sends it precisely so the poll can't wipe it.
                <span className="opacity-70">{value}</span>
              ) : (
                <Check className="size-4 text-primary" />
              )}
            </div>

            <div className="min-w-0">
              <div className="truncate text-sm">
                {p.display_name}
                {isMe ? <span className="text-muted-foreground"> (you)</span> : null}
              </div>
              {p.off_project ? (
                <Badge variant="outline" className="mt-0.5 text-[10px]">
                  left the project
                </Badge>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {vote ? (revealed ? "" : "voted") : "waiting"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
