import { Folder, Library } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { descendantIds, flattenForPicker, type FolderNode } from "./folder-tree";
import type { ReferenceFolder } from "@/types/api";

/**
 * Pick a destination for a document or a folder.
 *
 * A flat, indented list rather than a Select: the same shape as the rail the
 * user just came from, and a native select can't show hierarchy. "All documents"
 * is always an option, because the root is a real destination.
 *
 * When moving a *folder*, its own subtree is disabled rather than hidden — the
 * server rejects those moves anyway, and greying them out explains why instead
 * of leaving the user hunting for a folder that silently vanished from the list.
 */
export function MoveToFolderDialog({
  open,
  onOpenChange,
  title,
  roots,
  allFolders,
  currentFolderId,
  /** Set when moving a folder, so its own subtree can be ruled out. */
  movingFolderId,
  busy,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  roots: FolderNode[];
  allFolders: ReferenceFolder[];
  currentFolderId: number | null;
  movingFolderId?: number;
  busy: boolean;
  onMove: (folderId: number | null) => void;
}) {
  const blocked =
    movingFolderId != null ? descendantIds(allFolders, movingFolderId) : new Set<number>();
  const options = flattenForPicker(roots);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription>Choose where it should live.</DialogDescription>
        </DialogHeader>

        <div className="-mx-2 max-h-72 overflow-y-auto px-2">
          <Option
            icon={Library}
            label="All documents"
            depth={0}
            current={currentFolderId === null}
            disabled={busy || currentFolderId === null}
            onSelect={() => onMove(null)}
          />
          {options.map(({ folder, depth }) => (
            <Option
              key={folder.id}
              icon={Folder}
              label={folder.name}
              depth={depth + 1}
              current={currentFolderId === folder.id}
              disabled={busy || blocked.has(folder.id) || currentFolderId === folder.id}
              onSelect={() => onMove(folder.id)}
            />
          ))}
          {!options.length ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              There are no folders yet — create one first.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Option({
  icon: Icon,
  label,
  depth,
  current,
  disabled,
  onSelect,
}: {
  icon: typeof Folder;
  label: string;
  depth: number;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        "h-8 w-full justify-start gap-2 font-normal",
        current && "text-muted-foreground",
      )}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      disabled={disabled}
      onClick={onSelect}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {current ? <span className="ml-auto shrink-0 text-xs">current</span> : null}
    </Button>
  );
}
