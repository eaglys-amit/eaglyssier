import type { ReferenceFile, ReferenceFolder } from "@/types/api";

/**
 * Pure helpers over the flat folder list the API returns.
 *
 * Kept separate from the components, like breakdown-draft.ts: assembling a tree,
 * counting a subtree and guarding a move are all decisions worth reading on
 * their own, and none of them need React.
 *
 * `null` means the project root throughout — it is a real location documents sit
 * at (everything uploaded before folders existed is there), not "no folder".
 */

export interface FolderNode extends ReferenceFolder {
  children: FolderNode[];
  /** Documents filed directly in this folder. */
  fileCount: number;
  /** Documents in this folder and everything under it. */
  totalCount: number;
}

/**
 * Nest the flat rows, alphabetically at each level, and roll the file counts up.
 *
 * A row whose parent is missing — deleted in another tab, so the child arrived
 * in a stale list — is treated as top-level rather than dropped. Silently hiding
 * a folder the user can still see in the table's folder column would be worse
 * than showing it one level up.
 */
export function buildFolderTree(
  folders: ReferenceFolder[],
  files: ReferenceFile[] = [],
): FolderNode[] {
  const direct = new Map<number, number>();
  for (const file of files) {
    if (file.folder_id != null) {
      direct.set(file.folder_id, (direct.get(file.folder_id) ?? 0) + 1);
    }
  }

  const byId = new Map<number, FolderNode>(
    folders.map((f) => [
      f.id,
      { ...f, children: [], fileCount: direct.get(f.id) ?? 0, totalCount: 0 },
    ]),
  );

  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id == null ? null : byId.get(node.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortAndTotal = (nodes: FolderNode[]): number => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    let sum = 0;
    for (const node of nodes) {
      node.totalCount = node.fileCount + sortAndTotal(node.children);
      sum += node.totalCount;
    }
    return sum;
  };
  sortAndTotal(roots);

  return roots;
}

/** Documents filed directly in `folderId` (null = the project root). */
export function filesInFolder(
  files: ReferenceFile[],
  folderId: number | null,
): ReferenceFile[] {
  return files.filter((f) => (f.folder_id ?? null) === folderId);
}

/**
 * Every document in a folder and everything beneath it.
 *
 * What a folder-level checkbox acts on: a parent whose own documents all live
 * one level down should still be selectable in one click.
 */
export function subtreeFiles(files: ReferenceFile[], folder: FolderNode): ReferenceFile[] {
  const ids = new Set<number>();
  const walk = (node: FolderNode) => {
    ids.add(node.id);
    for (const child of node.children) walk(child);
  };
  walk(folder);
  return files.filter((f) => f.folder_id != null && ids.has(f.folder_id));
}

/**
 * Root → folder, for a breadcrumb. Empty for the root itself.
 *
 * Depth-capped: a parent chain that somehow cycles would otherwise hang the
 * render, and the server rejects cycles but a stale client list can still hold
 * a half-applied move.
 */
export function folderPath(
  folders: ReferenceFolder[],
  folderId: number | null,
): ReferenceFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: ReferenceFolder[] = [];
  let current = folderId == null ? undefined : byId.get(folderId);
  while (current && path.length < 64) {
    path.unshift(current);
    current = current.parent_id == null ? undefined : byId.get(current.parent_id);
  }
  return path;
}

/** `folderId` plus every folder beneath it — the set a move must not target. */
export function descendantIds(
  folders: ReferenceFolder[],
  folderId: number,
): Set<number> {
  const children = new Map<number, number[]>();
  for (const f of folders) {
    if (f.parent_id == null) continue;
    children.set(f.parent_id, [...(children.get(f.parent_id) ?? []), f.id]);
  }
  const seen = new Set([folderId]);
  const stack = [folderId];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}

/**
 * Flatten the tree for a picker: every folder, depth-tagged, in display order.
 *
 * The server is the authority on whether a move is legal; this is here so the
 * picker can grey out the impossible options rather than offering them and
 * letting the user earn a 409.
 */
export function flattenForPicker(
  roots: FolderNode[],
  depth = 0,
): Array<{ folder: FolderNode; depth: number }> {
  return roots.flatMap((folder) => [
    { folder, depth },
    ...flattenForPicker(folder.children, depth + 1),
  ]);
}
