/** Shared bits of the repository views. */
export const isRunning = (s: string | undefined | null) => s === "running";

/** Module-level so the prop identity is stable across renders. */
export const GIT_TYPES = ["github", "gitlab"];

export type RepoView = "summary" | "pulls" | "commits";

/** No active member = no filter; otherwise only rows authored by that member. */
export function byMember<T extends { author_member_id: number | null }>(
  rows: T[],
  memberId: number | null,
): T[] {
  if (memberId == null) return rows;
  return rows.filter((r) => r.author_member_id === memberId);
}

export function Diff({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="font-mono text-xs tabular-nums whitespace-nowrap">
      <span className="text-success">+{additions}</span>{" "}
      <span className="text-destructive">−{deletions}</span>
    </span>
  );
}
