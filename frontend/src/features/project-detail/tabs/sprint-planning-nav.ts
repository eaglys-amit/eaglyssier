import { Spade, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useViewParams } from "./useViewParams";

/**
 * Sub-views of the Sprint Planning page, selected by `?view=`. Single source of
 * truth for the segmented control and the view union, the way scrum-nav.ts is
 * for Scrums & Epics.
 *
 * These two used to sit in the Scrums tab beside the board, the epic tree and
 * the charts. They're a different activity: those three read and arrange work
 * that already exists, while these two produce it — a breakdown generates the
 * tasks and poker puts numbers on them. Six peers in one segmented control also
 * read like a view switch rather than the workflow it is, so estimating is now
 * somewhere you go, entered from the Scrums & Epics title bar.
 *
 * `ai` drafts a work tree but does NOT manage the documents it reads — those are
 * project-scoped, so upload and the file list live in the Documents tab.
 */
export const PLANNING_VIEWS = [
  { key: "ai", label: "AI Breakdown", icon: Sparkles },
  { key: "poker", label: "Poker", icon: Spade },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  icon: LucideIcon;
}>;

export type PlanningView = (typeof PLANNING_VIEWS)[number]["key"];

// Breakdown first: it makes the tasks, and estimating something that doesn't
// exist yet isn't a workflow. Landing on poker meant the page opened on the
// second step.
export const DEFAULT_PLANNING_VIEW: PlanningView = "ai";

export function isPlanningView(value: string | null): value is PlanningView {
  return PLANNING_VIEWS.some((v) => v.key === value);
}

/** The page's `?view=`/`?sprint=` state. See useViewParams. */
export function usePlanningParams() {
  return useViewParams(isPlanningView, DEFAULT_PLANNING_VIEW);
}
