import { useSearchParams } from "react-router-dom";

import {
  DEFAULT_MILESTONE_VIEW,
  isMilestoneView,
  type MilestoneView,
} from "./milestone-nav";

/**
 * The Milestones tab's UI state, in the URL: `?view=` picks the sub-view and
 * `?milestone=` opens the detail sheet. Search params rather than local state
 * so a view is deep-linkable and survives a refresh — the same reason
 * `?task=`/`?commit=` drive the slide-overs. Mirrors useScrumParams.
 */
export function useMilestoneParams() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: MilestoneView = isMilestoneView(raw) ? raw : DEFAULT_MILESTONE_VIEW;
  const milestoneId = Number(params.get("milestone")) || null;

  /** Merge into the existing params so ?task= survives a view switch. */
  const patch = (next: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const merged = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(next)) {
          if (value === null) merged.delete(key);
          else merged.set(key, value);
        }
        return merged;
      },
      { replace: true },
    );
  };

  return {
    view,
    milestoneId,
    setView: (next: MilestoneView) => patch({ view: next }),
    setMilestoneId: (next: number | null) =>
      patch({ milestone: next === null ? null : String(next) }),
  };
}
