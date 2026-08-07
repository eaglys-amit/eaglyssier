import { FileText, LayoutList, MessageSquare, Spade, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Sub-views of the Scrums tab, selected by `?view=`. Single source of truth for
 * the segmented control and the view union, the way settings-nav.ts is for the
 * setup pages.
 *
 * The backlog and sprint planning are deliberately ONE view: planning is moving
 * work out of the backlog into a sprint while a commitment meter tracks you
 * against capacity. Splitting them would mean two lists of the same tasks.
 */
export const SCRUM_VIEWS = [
  { key: "board", label: "Board", icon: LayoutList, ready: true },
  { key: "poker", label: "Poker", icon: Spade, ready: true },
  { key: "docs", label: "Reference & AI", icon: FileText, ready: true },
  { key: "charts", label: "Charts", icon: TrendingUp, ready: false },
  { key: "notes", label: "Standups & Retro", icon: MessageSquare, ready: false },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  icon: LucideIcon;
  /** Shipped, vs. a placeholder for a later phase. */
  ready: boolean;
}>;

export type ScrumView = (typeof SCRUM_VIEWS)[number]["key"];

export const DEFAULT_SCRUM_VIEW: ScrumView = "board";

export function isScrumView(value: string | null): value is ScrumView {
  return SCRUM_VIEWS.some((v) => v.key === value);
}
