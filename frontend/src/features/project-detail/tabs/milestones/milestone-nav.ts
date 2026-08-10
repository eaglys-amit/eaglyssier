import { ListChecks, Map } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Sub-views of the Milestones tab, selected by `?view=`. Single source of truth
 * for the segmented control and the view union, the way scrum-nav.ts is for the
 * Scrums tab.
 *
 * Two views over one dataset, not two features: the roadmap is for reading
 * dates against the sprint cadence, the list is for reading numbers and editing.
 */
export const MILESTONE_VIEWS = [
  { key: "roadmap", label: "Roadmap", icon: Map },
  { key: "list", label: "List", icon: ListChecks },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  icon: LucideIcon;
}>;

export type MilestoneView = (typeof MILESTONE_VIEWS)[number]["key"];

export const DEFAULT_MILESTONE_VIEW: MilestoneView = "roadmap";

export function isMilestoneView(value: string | null): value is MilestoneView {
  return MILESTONE_VIEWS.some((v) => v.key === value);
}
