export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

/** Story points for display: one decimal, dropping a trailing .0. */
export function formatPoints(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n.toFixed(1)).toString();
}

/**
 * Display handle for a task. Mirrors app.services.tasks.task_label: locally
 * created tasks have no Jira key, so they show as '#<id>'.
 */
export function taskLabel(task: { id: number; external_key: string | null }): string {
  return task.external_key || `#${task.id}`;
}

/** Human-readable byte size: 1.4 MB, 812 kB, 96 B. */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} kB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}
