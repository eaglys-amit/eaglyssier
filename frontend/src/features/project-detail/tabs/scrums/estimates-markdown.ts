import { formatPoints } from "@/lib/format";
import type { PokerQueueItem, PokerSessionDetail } from "@/types/api";

/** A cell in a pipe table can't contain a bare `|`, and newlines end the row. */
function cell(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim() || "—";
}

/** The task's handle. Mirrors format.taskLabel: local tasks have no tracker key. */
function key(item: PokerQueueItem): string {
  return item.task_key || `#${item.task_id}`;
}

function epic(item: PokerQueueItem): string {
  if (item.epic_task_id == null) return "—";
  return cell(item.epic_title?.trim() || item.epic_key || `#${item.epic_task_id}`);
}

/**
 * What the room agreed, as a markdown document — the thing you paste into a
 * ticket, a planning doc, or a standup note.
 *
 * Pure and total so the serialisation can be read and checked on its own. Every
 * number goes through formatPoints, so the file says exactly what the screen
 * says rather than drifting by a decimal.
 */
export function toEstimatesMarkdown(
  session: PokerSessionDetail,
  applied: PokerQueueItem[],
): string {
  const total = applied.reduce((sum, item) => sum + (item.story_points ?? 0), 0);

  const lines: string[] = [
    // Session name on its own line: names routinely contain a dash already, and
    // "<name> — estimated tasks" turned into a pileup of them.
    `# ${session.name}`,
    "",
    "## Estimated tasks",
    "",
    `- **Estimated:** ${session.estimated} of ${session.queued} queued`,
    `- **Total:** ${formatPoints(total)} pts`,
  ];

  if (session.facilitator_name) {
    lines.push(`- **Facilitator:** ${session.facilitator_name}`);
  }

  lines.push(
    "",
    "| Key | Task | Epic | Rounds | Points |",
    "| --- | ---- | ---- | -----: | -----: |",
  );

  for (const item of applied) {
    lines.push(
      `| ${cell(key(item))} | ${cell(item.task_title)} | ${epic(item)} ` +
        `| ${item.attempts} | ${formatPoints(item.story_points)} |`,
    );
  }

  lines.push(
    "",
    `**${applied.length} ${applied.length === 1 ? "task" : "tasks"} · ` +
      `${formatPoints(total)} pts**`,
    "",
  );

  return lines.join("\n");
}
