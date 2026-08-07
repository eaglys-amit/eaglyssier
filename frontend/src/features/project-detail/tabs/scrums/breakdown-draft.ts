import type { BreakdownNode } from "@/types/api";

/**
 * A draft node plus the local review state: nested for display, with an
 * accept flag per node.
 *
 * The wire format is flat with string parent refs (models emit that far more
 * reliably than deep nesting), so nesting happens here rather than on the
 * server.
 */
export interface DraftNode extends BreakdownNode {
  children: DraftNode[];
  accepted: boolean;
  /** Points summed over accepted leaf descendants; own points for a leaf. */
  rollup: number;
}

/** Nest the flat list, defaulting everything to accepted. */
export function toDraft(nodes: BreakdownNode[]): DraftNode[] {
  const wrapped = new Map<string, DraftNode>(
    nodes.map((n) => [n.id, { ...n, children: [], accepted: true, rollup: 0 }]),
  );
  const roots: DraftNode[] = [];
  for (const node of nodes) {
    const self = wrapped.get(node.id)!;
    const parent = node.parent ? wrapped.get(node.parent) : undefined;
    // A parent that isn't in the list can't happen (the server repairs unknown
    // refs to null) but falling back to top level beats dropping the node.
    if (parent && parent !== self) parent.children.push(self);
    else roots.push(self);
  }
  return withRollups(roots);
}

/** Recompute the accepted-points rollup across the tree. */
export function withRollups(nodes: DraftNode[]): DraftNode[] {
  const visit = (node: DraftNode): DraftNode => {
    const children = node.children.map(visit);
    const rollup = children.length
      ? children.reduce((sum, c) => sum + (c.accepted ? c.rollup : 0), 0)
      : (node.story_points ?? 0);
    return { ...node, children, rollup: Math.round(rollup * 10) / 10 };
  };
  return nodes.map(visit);
}

/** Apply a patch to one node by id, anywhere in the tree. */
export function setNode(
  nodes: DraftNode[],
  id: string,
  patch: Partial<DraftNode>,
): DraftNode[] {
  return withRollups(
    nodes.map((node) =>
      node.id === id
        ? { ...node, ...patch }
        : { ...node, children: setNode(node.children, id, patch) },
    ),
  );
}

/**
 * Toggle acceptance, cascading down.
 *
 * Unchecking a parent unchecks its whole subtree — a subtask can't outlive the
 * task that contains it. Re-checking a parent restores its subtree, which is
 * the reverse of what people expect only if they'd unchecked a child
 * individually first; that's a fair trade for the cascade being predictable.
 */
export function toggleAccept(
  nodes: DraftNode[],
  id: string,
  accepted: boolean,
): DraftNode[] {
  const cascade = (node: DraftNode): DraftNode => ({
    ...node,
    accepted,
    children: node.children.map(cascade),
  });
  return withRollups(
    nodes.map((node) =>
      node.id === id
        ? cascade(node)
        : { ...node, children: toggleAccept(node.children, id, accepted) },
    ),
  );
}

/** Delete a node and its subtree from the draft entirely. */
export function removeNode(nodes: DraftNode[], id: string): DraftNode[] {
  return withRollups(
    nodes
      .filter((node) => node.id !== id)
      .map((node) => ({ ...node, children: removeNode(node.children, id) })),
  );
}

export function countAccepted(nodes: DraftNode[]): { tasks: number; points: number } {
  let tasks = 0;
  let points = 0;
  const visit = (node: DraftNode) => {
    if (!node.accepted) return;
    tasks += 1;
    // Leaves only, matching the server: a container's points roll up.
    if (!node.children.length) points += node.story_points ?? 0;
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return { tasks, points: Math.round(points * 10) / 10 };
}

/** Ids of accepted nodes, for the accept call. */
export function acceptedIds(nodes: DraftNode[]): string[] {
  const out: string[] = [];
  const visit = (node: DraftNode) => {
    if (!node.accepted) return;
    out.push(node.id);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

/** Flatten back to the wire format for a draft save. */
export function toWire(nodes: DraftNode[]): BreakdownNode[] {
  const out: BreakdownNode[] = [];
  const visit = (node: DraftNode, parent: string | null) => {
    const { children, accepted: _a, rollup: _r, ...rest } = node;
    out.push({ ...rest, parent });
    children.forEach((child) => visit(child, node.id));
  };
  nodes.forEach((n) => visit(n, null));
  return out;
}

/**
 * Guard the one place a malformed payload is fatal rather than cosmetic: the
 * recursive renderer would loop forever on a bad `children` shape. There's no
 * zod in this repo, and a general validation layer would be out of character —
 * this is the single spot that needs one.
 */
export function isBreakdownNode(value: unknown): value is BreakdownNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  return typeof node.id === "string" && typeof node.title === "string";
}
