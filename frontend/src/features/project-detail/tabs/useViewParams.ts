import { useSearchParams } from "react-router-dom";

/**
 * A page's sub-view state, in the URL: `?view=` picks the sub-view and
 * `?sprint=` scopes it. Search params rather than local state so a view is
 * deep-linkable and survives a refresh — the same reason `?task=`/`?commit=`
 * drive the slide-overs.
 *
 * Generic over the view union because two pages need it with different unions
 * (Scrums & Epics, and Sprint Planning) and only the guard differs. The `patch`
 * below is the part that must not be duplicated: it merges into the existing
 * params so `?task=`/`?member=` survive a view switch, and it's the reason
 * moving between the two pages can carry `?sprint=` across.
 */
export function useViewParams<V extends string>(
  isView: (value: string | null) => value is V,
  fallback: V,
) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: V = isView(raw) ? raw : fallback;
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
    setView: (next: V) => patch({ view: next }),
    setSprintId: (next: number | null) => patch({ sprint: next === null ? null : String(next) }),
  };
}
