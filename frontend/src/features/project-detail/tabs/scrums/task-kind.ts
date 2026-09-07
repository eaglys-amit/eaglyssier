/**
 * One answer to "is this row structure or work?", shared by the board and the
 * Epics view.
 *
 * These two used to decide it separately and disagreed: the board asked only
 * whether a task had children, while the Epics view also counted the issue
 * type. A Jira epic whose subtasks were all in sprints — or one nobody had
 * broken down yet — therefore showed up in the board's backlog as a row to
 * estimate, in the same breath as the Epics view claiming it.
 *
 * Nothing about points depends on this. Story-point sums use the purely
 * structural rule instead (app.services.tasks.leaf_only), because a childless
 * epic really does hold its own points and dropping it from a SUM would lose
 * them.
 */

/**
 * An epic by declared type, whatever its shape.
 *
 * The type is a statement of intent: an epic with no children yet is still an
 * epic, and the board should no more offer it for planning than a full one.
 */
export function isEpicType(issueType: string | null | undefined): boolean {
  return issueType?.toLowerCase() === "epic";
}

/** Structure rather than a work item: an epic, or anything with children. */
export function isContainer(
  task: { issue_type: string | null },
  childCount: number,
): boolean {
  return childCount > 0 || isEpicType(task.issue_type);
}
