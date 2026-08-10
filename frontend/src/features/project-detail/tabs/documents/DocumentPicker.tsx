import { Folder, Library } from "lucide-react";
import { useMemo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import type { ReferenceFile } from "@/types/api";

import { buildFolderTree, filesInFolder, flattenForPicker, subtreeFiles } from "./folder-tree";
import { useReferenceFolders } from "./useReferenceFolders";

/**
 * Pick documents to feed something — today the AI breakdown.
 *
 * Grouped by folder, because a flat list of every readable document in the
 * project gets *worse* as the project grows, which is the whole reason folders
 * exist. A folder's checkbox covers its entire subtree, so "use everything under
 * specs/" is one click rather than eight.
 *
 * Lives with the documents feature rather than with the breakdown: it is about
 * the shape of the document tree, and anything else that needs to pick documents
 * (a report, a task attachment) should reuse it rather than re-group by hand.
 */
export function DocumentPicker({
  projectId,
  /** Already filtered to the documents that are legal to pick. */
  files,
  selected,
  onChange,
}: {
  projectId: number;
  files: ReferenceFile[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const { folders } = useReferenceFolders(projectId);
  const folderRows = folders ?? [];

  // One group per location that actually holds pickable documents. Empty folders
  // are skipped: a heading with nothing under it is just noise here, unlike in
  // the rail where it's a real place to put things.
  const groups = useMemo(() => {
    const roots = buildFolderTree(folderRows, files);
    const rootFiles = filesInFolder(files, null);
    return [
      ...(rootFiles.length
        ? [{ id: null, name: "All documents", depth: 0, files: rootFiles, subtree: rootFiles }]
        : []),
      ...flattenForPicker(roots)
        .filter(({ folder }) => folder.totalCount > 0)
        .map(({ folder, depth }) => ({
          id: folder.id as number | null,
          name: folder.name,
          depth,
          files: filesInFolder(files, folder.id),
          subtree: subtreeFiles(files, folder),
        })),
    ];
  }, [folderRows, files]);

  const toggleMany = (ids: number[], on: boolean) => {
    const set = new Set(selected);
    for (const id of ids) {
      if (on) set.add(id);
      else set.delete(id);
    }
    // Rebuilt in `files` order rather than appended in click order: the id list
    // becomes the document order in the prompt, where earlier means more
    // important, so it shouldn't depend on which checkbox was ticked first.
    onChange(files.filter((f) => set.has(f.id)).map((f) => f.id));
  };

  if (!groups.length) return null;

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const ids = group.subtree.map((f) => f.id);
        const picked = ids.filter((id) => selected.includes(id)).length;
        const state = picked === 0 ? false : picked === ids.length ? true : "indeterminate";

        return (
          <div key={group.id ?? "root"} style={{ paddingLeft: `${group.depth * 0.875}rem` }}>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={state}
                onCheckedChange={(v) => toggleMany(ids, v === true)}
                aria-label={`Select every document in ${group.name}`}
              />
              {group.id === null ? (
                <Library className="size-3.5" />
              ) : (
                <Folder className="size-3.5" />
              )}
              <span className="truncate font-medium">{group.name}</span>
              <span className="font-mono text-[10px] tabular-nums">
                {picked}/{ids.length}
              </span>
            </label>

            <div className="mt-1 ml-6 space-y-1">
              {group.files.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(f.id)}
                    onCheckedChange={(v) => toggleMany([f.id], v === true)}
                  />
                  <span className="truncate">{f.filename}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {f.char_count.toLocaleString()} chars
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
