import { useSearchParams } from "react-router-dom";

import { DEFAULT_SCRUM_VIEW, isScrumView, type ScrumView } from "./scrum-nav";

/**
 * The Scrums tab's UI state, in the URL: `?view=` picks the sub-view and
 * `?sprint=` scopes it. Search params rather than local state so a view is
 * deep-linkable and survives a refresh — the same reason `?task=`/`?commit=`
 * drive the slide-overs.
 */
export function useScrumParams() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: ScrumView = isScrumView(raw) ? raw : DEFAULT_SCRUM_VIEW;
  const sprintId = Number(params.get("sprint")) || null;

  /** Merge into the existing params so ?task=/?member= survive a view switch. */
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
    sprintId,
    setView: (next: ScrumView) => patch({ view: next }),
    setSprintId: (next: number | null) => patch({ sprint: next === null ? null : String(next) }),
  };
}
