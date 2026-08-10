import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Library,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { FolderNode } from "./folder-tree";

/**
 * The document tree's left rail.
 *
 * "All documents" is a real selectable location, not a filter: folder_id is
 * nullable, so the root holds every document nobody has filed — including all of
 * them, on a project that predates folders.
 *
 * Expansion is local state. It is view-only ornamentation that changes on every
 * click, and putting it in the URL alongside `?folder=` would mean a history
 * entry for each disclosure triangle.
 */
export function FolderTree({
  roots,
  rootCount,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onMove,
  onDelete,
  busy,
}: {
  roots: FolderNode[];
  /** Documents sitting at the project root. */
  rootCount: number;
  selectedId: number | null;
  onSelect: (folderId: number | null) => void;
  onCreate: (parentId: number | null) => void;
  onRename: (folder: FolderNode) => void;
  onMove: (folder: FolderNode) => void;
  onDelete: (folder: FolderNode) => void;
  busy: boolean;
}) {
  const total = rootCount + roots.reduce((sum, f) => sum + f.totalCount, 0);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b bg-muted px-2">
        <h2 className="px-1 text-sm font-semibold tracking-tight">Folders</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => onCreate(null)}
          title="New top-level folder"
        >
          <FolderPlus className="size-3.5" />
          <span className="sr-only">New top-level folder</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(ROW_CLASS, selectedId === null ? ACTIVE_CLASS : IDLE_CLASS)}
        >
          <Library className="size-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">All documents</span>
          <Count value={total} />
        </button>

        {roots.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            onCreate={onCreate}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
            busy={busy}
          />
        ))}

        {!roots.length ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No folders yet. Everything lives in All documents.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Hoisted like ProjectSidebar's ITEM_CLASS: three states of one row, read side
// by side rather than interpolated at three call sites.
const ROW_CLASS =
  "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors";
const ACTIVE_CLASS = "bg-accent font-medium text-accent-foreground";
const IDLE_CLASS = "text-muted-foreground hover:bg-accent/50 hover:text-foreground";

function FolderRow({
  folder,
  depth,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onMove,
  onDelete,
  busy,
}: {
  folder: FolderNode;
  depth: number;
  selectedId: number | null;
  onSelect: (folderId: number | null) => void;
  onCreate: (parentId: number | null) => void;
  onRename: (folder: FolderNode) => void;
  onMove: (folder: FolderNode) => void;
  onDelete: (folder: FolderNode) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = selectedId === folder.id;
  const hasChildren = folder.children.length > 0;

  return (
    <>
      <div
        className={cn(ROW_CLASS, selected ? ACTIVE_CLASS : IDLE_CLASS)}
        // Indent on the wrapper, not the label: the row's hover and selected
        // background should still run the full width of the rail.
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {/* A fixed-size slot whether or not there is a triangle, so names at the
            same depth line up. */}
        <span className="flex size-4 shrink-0 items-center justify-center">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded hover:bg-background/60"
              aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
              />
            </button>
          ) : null}
        </span>

        <button
          type="button"
          onClick={() => onSelect(folder.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open && hasChildren ? (
            <FolderOpen className="size-3.5 shrink-0" />
          ) : (
            <Folder className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{folder.name}</span>
        </button>

        <Count value={folder.totalCount} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              // Always reachable by keyboard; only visible on hover, focus or
              // while selected, so the rail isn't a column of ⋯ buttons.
              className={cn(
                "size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                selected && "opacity-100",
              )}
            >
              <MoreHorizontal className="size-3.5" />
              <span className="sr-only">Actions for {folder.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onCreate(folder.id)}>
              <FolderPlus className="size-3.5" /> New subfolder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRename(folder)}>
              <Pencil className="size-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(folder)}>
              <Folder className="size-3.5" /> Move to…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Deleting only records the intent — the confirm dialog is owned by
                DocumentsTab, because Radix unmounts this menu on select and would
                take a dialog nested inside it down with it. */}
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(folder)}>
              <Trash2 className="size-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open
        ? folder.children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreate={onCreate}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
              busy={busy}
            />
          ))
        : null}
    </>
  );
}

function Count({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
      {value}
    </span>
  );
}
