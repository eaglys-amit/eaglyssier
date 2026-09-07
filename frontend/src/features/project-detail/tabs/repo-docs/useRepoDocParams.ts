import { useSearchParams } from "react-router-dom";

/**
 * The page's `?repo=`/`?doc=` state, merged into the existing params the way
 * useViewParams and useDocumentParams do.
 *
 * Its own hook rather than another useViewParams caller: there is no view union
 * here, and the two params are *coupled* in a way the generic hook can't
 * express — changing `?repo` must clear `?doc`, because a document id belongs
 * to exactly one repository and carrying it across would leave repo B's tree
 * with repo A's document open and 404ing in the pane.
 *
 * Expansion state stays local for the same reason as the Documents rail: it
 * changes on every click and would otherwise fill the history with disclosure
 * triangles.
 */
export function useRepoDocParams() {
  const [params, setParams] = useSearchParams();

  const repoId = positive(params.get("repo"));
  const docId = positive(params.get("doc"));

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
    repoId,
    docId,
    /** Switching repository always drops the open document. See above. */
    setRepoId: (next: number | null) =>
      patch({ repo: next === null ? null : String(next), doc: null }),
    setDocId: (next: number | null) =>
      patch({ doc: next === null ? null : String(next) }),
  };
}

function positive(raw: string | null): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
