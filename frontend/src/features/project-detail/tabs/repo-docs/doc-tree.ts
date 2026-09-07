import type { JobStatus, RepoDoc, RepoDocFolder, RepoDocSet } from "@/types/api";

import { folderPath } from "../documents/folder-tree";

/**
 * Pure helpers over the flat folder/document lists the API returns.
 *
 * The structural helpers (folderPath, descendantIds, flattenForPicker) are
 * imported from the Documents tab's folder-tree, which is generic over the row
 * shape for exactly this reason. Only the counting is local, because a
 * documentation set rolls up four job-status buckets where a reference folder
 * rolls up one file count.
 *
 * `null` means the root of the set throughout — a real location documents sit
 * at, not "no folder".
 */

export interface DocFolderNode extends RepoDocFolder {
  children: DocFolderNode[];
  /** Documents filed directly here. */
  docCount: number;
  /** This folder and everything under it. */
  totalCount: number;
  /** Rolled up, for the rail's "7/12" counter. */
  readyCount: number;
  /** queued + running, rolled up — drives the spinner on a collapsed parent. */
  activeCount: number;
  failedCount: number;
}

/** In a queue, or being written. The poll predicate. */
export function isActive(status: JobStatus | undefined): boolean {
  return status === "queued" || status === "running";
}

/**
 * Nest the folders, ordered by rank then name, and roll the counters up.
 *
 * A folder whose parent is missing — deleted in another tab, so this list is
 * stale — renders top-level rather than vanishing, the same rule
 * buildFolderTree applies. Silently hiding a folder the user can still see
 * named in the breadcrumb would be worse than showing it one level up.
 */
export function buildDocTree(
  folders: RepoDocFolder[],
  docs: RepoDoc[],
): DocFolderNode[] {
  const direct = new Map<number, RepoDoc[]>();
  for (const doc of docs) {
    if (doc.folder_id != null) {
      direct.set(doc.folder_id, [...(direct.get(doc.folder_id) ?? []), doc]);
    }
  }

  const byId = new Map<number, DocFolderNode>(
    folders.map((f) => {
      const own = direct.get(f.id) ?? [];
      return [
        f.id,
        {
          ...f,
          children: [],
          docCount: own.length,
          totalCount: 0,
          readyCount: own.filter((d) => d.has_content).length,
          activeCount: own.filter((d) => isActive(d.status)).length,
          failedCount: own.filter((d) => d.status === "failed").length,
        },
      ];
    }),
  );

  const roots: DocFolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id == null ? null : byId.get(node.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortAndRoll = (nodes: DocFolderNode[]) => {
    nodes.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    for (const node of nodes) {
      sortAndRoll(node.children);
      node.totalCount = node.docCount;
      for (const child of node.children) {
        node.totalCount += child.totalCount;
        node.readyCount += child.readyCount;
        node.activeCount += child.activeCount;
        node.failedCount += child.failedCount;
      }
    }
  };
  sortAndRoll(roots);

  return roots;
}

/** Documents filed directly in `folderId` (null = the root of the set). */
export function docsInFolder(docs: RepoDoc[], folderId: number | null): RepoDoc[] {
  return docs
    .filter((d) => (d.folder_id ?? null) === folderId)
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

/** Every document in a folder and everything beneath it. */
export function subtreeDocs(docs: RepoDoc[], folder: DocFolderNode): RepoDoc[] {
  const ids = new Set<number>();
  const walk = (node: DocFolderNode) => {
    ids.add(node.id);
    for (const child of node.children) walk(child);
  };
  walk(folder);
  return docs.filter((d) => d.folder_id != null && ids.has(d.folder_id));
}

/** The folder chain down to a document, for the breadcrumb and rail expansion. */
export function docFolderPath(
  folders: RepoDocFolder[],
  folderId: number | null,
): RepoDocFolder[] {
  return folderPath(folders, folderId);
}

export interface SetProgress {
  total: number;
  ready: number;
  active: number;
  failed: number;
  missing: number;
}

/** The queue footer's numbers, derived so it never disagrees with the tree. */
export function setProgress(set: RepoDocSet | undefined): SetProgress {
  const docs = set?.docs ?? [];
  return {
    total: docs.length,
    ready: docs.filter((d) => d.has_content).length,
    active: docs.filter((d) => isActive(d.status)).length,
    failed: docs.filter((d) => d.status === "failed").length,
    missing: docs.filter((d) => !d.has_content).length,
  };
}
