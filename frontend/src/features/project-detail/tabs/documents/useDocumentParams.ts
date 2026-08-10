import { useSearchParams } from "react-router-dom";

/**
 * The Documents tab's UI state in the URL: `?folder=` selects a folder, absent
 * means the project root ("All documents").
 *
 * A search param rather than local state for the same reason as `?view=` in
 * useScrumParams — a folder is worth linking to, and it survives a refresh.
 * Folder expansion stays local: that changes on every click and would otherwise
 * fill the history with disclosure triangles.
 */
export function useDocumentParams() {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get("folder"));
  const folderId = Number.isSafeInteger(raw) && raw > 0 ? raw : null;

  const setFolderId = (next: number | null) => {
    setParams(
      (prev) => {
        const merged = new URLSearchParams(prev);
        if (next === null) merged.delete("folder");
        else merged.set("folder", String(next));
        return merged;
      },
      { replace: true },
    );
  };

  return { folderId, setFolderId };
}
