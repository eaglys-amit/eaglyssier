import { Coffee, HelpCircle } from "lucide-react";

import { formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The card deck, built from the session's snapshotted scale.
 *
 * Cards the scale flags `needs_breakdown` get a warning ring: picking one is
 * legal but it means "this is too big to work on directly". The "?" card is a
 * real vote (abstain) rather than the absence of one — it says "I can't
 * estimate this", which is information the room needs.
 */
export function PokerDeck({
  deck,
  breakdownPoints,
  selected,
  abstained,
  disabled,
  onPick,
}: {
  deck: number[];
  breakdownPoints: number[];
  selected: number | null;
  abstained: boolean;
  disabled: boolean;
  onPick: (points: number | null, abstain: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {deck.map((points) => {
        const isSelected = !abstained && selected === points;
        const needsBreakdown = breakdownPoints.includes(points);
        return (
          <button
            key={points}
            type="button"
            disabled={disabled}
            // Clicking your own card again takes it back, which is how you undo
            // a mis-click before the reveal.
            onClick={() => onPick(isSelected ? null : points, false)}
            aria-pressed={isSelected}
            title={needsBreakdown ? "The scale says to break this down first" : undefined}
            className={cn(
              "flex h-16 w-12 flex-col items-center justify-center rounded-lg border-2 font-mono text-lg tabular-nums transition-all",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isSelected
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card hover:border-primary/50 hover:bg-accent",
              needsBreakdown && !isSelected && "border-warning/60",
            )}
          >
            {formatPoints(points)}
            {needsBreakdown ? (
              <span className="mt-0.5 text-[9px] font-sans leading-none opacity-70">split</span>
            ) : null}
          </button>
        );
      })}

      <div className="mx-1 w-px self-stretch bg-border" />

      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(null, !abstained)}
        aria-pressed={abstained}
        title="I don't know enough to estimate this"
        className={cn(
          "flex h-16 w-12 flex-col items-center justify-center gap-1 rounded-lg border-2 transition-all",
          "disabled:cursor-not-allowed disabled:opacity-40",
          abstained
            ? "border-primary bg-primary text-primary-foreground shadow-sm"
            : "border-border bg-card hover:border-primary/50 hover:bg-accent",
        )}
      >
        <HelpCircle className="size-5" />
        <span className="text-[9px] leading-none opacity-70">unsure</span>
      </button>

      {/* Not a vote — just the universally understood "I need a minute". */}
      <div
        className="flex h-16 w-12 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground"
        title="Break time — not a vote"
      >
        <Coffee className="size-5" />
      </div>
    </div>
  );
}
