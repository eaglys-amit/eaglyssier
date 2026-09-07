import {
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RepoDoc, RepoDocFolder } from "@/types/api";

import { docFolderPath, docsInFolder, type DocFolderNode } from "./doc-tree";
import { DocStatusDot } from "./DocStatusDot";

/**
 * The documentation set's left rail: folders, with the documents as leaves.
 *
 * Structurally the Documents tab's FolderTree, with one real difference —
 * documents live in the same tree rather than in a table beside it. A doc set is
 * a dozen items you navigate one at a time, not a list you sort and filter, so a
 * single tree is the whole navigation and the right pane is always one document.
 *
 * Expansion is local state, as in FolderTree: it changes on every click and
 * would otherwise fill the history with disclosure triangles. The exception is
 * seeding it from the selected document's ancestors, without which a deep link
 * opens a document that isn't visible in the rail.
 */
export function DocSetTree({
  roots,
  folders,
  docs,
  selectedDocId,
  selectedFolderId,
  onSelectDoc,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onGenerateFolder,
  onCreateDoc,
  onRenameDoc,
  onMoveDoc,
  onDeleteDoc,
  onGenerateDoc,
  busy,
}: {
  roots: DocFolderNode[];
  folders: RepoDocFolder[];
  docs: RepoDoc[];
  selectedDocId: number | null;
  selectedFolderId: number | null;
  onSelectDoc: (docId: number) => void;
  onSelectFolder: (folderId: number | null) => void;
  onCreateFolder: (parentId: number | null) => void;
  onRenameFolder: (folder: DocFolderNode) => void;
  onMoveFolder: (folder: DocFolderNode) => void;
  onDeleteFolder: (folder: DocFolderNode) => void;
  onGenerateFolder: (folder: DocFolderNode) => void;
  onCreateDoc: (folderId: number | null) => void;
  onRenameDoc: (doc: RepoDoc) => void;
  onMoveDoc: (doc: RepoDoc) => void;
  onDeleteDoc: (doc: RepoDoc) => void;
  onGenerateDoc: (doc: RepoDoc) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rootDocs = docsInFolder(docs, null);

  // Reveal the selected document's folder chain. Runs when the selection moves
  // outside the open set — including on mount, which is the deep-link case.
  const selectedDoc = docs.find((d) => d.id === selectedDocId);
  const chainKey = selectedDoc
    ? docFolderPath(folders, selectedDoc.folder_id)
        .map((f) => f.id)
        .join("/")
    : "";
  useEffect(() => {
    if (!chainKey) return;
    const ids = chainKey.split("/").filter(Boolean).map(Number);
    setOpen((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      return new Set([...prev, ...ids]);
    });
  }, [chainKey]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="bg-card flex h-full min-h-0 flex-col rounded-lg border">
      <div className="bg-muted flex h-9 shrink-0 items-center justify-between gap-1 border-b px-2">
        <h2 className="px-1 text-sm font-semibold tracking-tight">Documents</h2>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => onCreateFolder(null)}
            title="New top-level folder"
          >
            <FolderPlus className="size-3.5" />
            <span className="sr-only">New top-level folder</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => onCreateDoc(null)}
            title="New document at the root"
          >
            <FilePlus className="size-3.5" />
            <span className="sr-only">New document at the root</span>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {roots.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            depth={0}
            docs={docs}
            expanded={open}
            onToggle={toggle}
            selectedDocId={selectedDocId}
            selectedFolderId={selectedFolderId}
            onSelectDoc={onSelectDoc}
            onSelectFolder={onSelectFolder}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onMoveFolder={onMoveFolder}
            onDeleteFolder={onDeleteFolder}
            onGenerateFolder={onGenerateFolder}
            onCreateDoc={onCreateDoc}
            onRenameDoc={onRenameDoc}
            onMoveDoc={onMoveDoc}
            onDeleteDoc={onDeleteDoc}
            onGenerateDoc={onGenerateDoc}
            busy={busy}
          />
        ))}

        {/* Documents at the set root come after the folders, the way a file
            manager puts loose files under the directories. */}
        {rootDocs.map((doc) => (
          <DocRow
            key={doc.id}
            doc={doc}
            depth={0}
            selected={selectedDocId === doc.id}
            onSelect={onSelectDoc}
            onRename={onRenameDoc}
            onMove={onMoveDoc}
            onDelete={onDeleteDoc}
            onGenerate={onGenerateDoc}
            busy={busy}
          />
        ))}

        {!roots.length && !rootDocs.length ? (
          <p className="text-muted-foreground px-2 py-3 text-xs">
            Nothing here yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Hoisted like FolderTree's, so the three states of a row read side by side.
const ROW_CLASS =
  "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors";
const ACTIVE_CLASS = "bg-accent font-medium text-accent-foreground";
const IDLE_CLASS = "text-muted-foreground hover:bg-accent/50 hover:text-foreground";
const MENU_CLASS =
  "size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100";

function FolderRow({
  folder,
  depth,
  docs,
  expanded,
  onToggle,
  selectedDocId,
  selectedFolderId,
  onSelectDoc,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onGenerateFolder,
  onCreateDoc,
  onRenameDoc,
  onMoveDoc,
  onDeleteDoc,
  onGenerateDoc,
  busy,
}: {
  folder: DocFolderNode;
  depth: number;
  docs: RepoDoc[];
  expanded: Set<number>;
  onToggle: (id: number) => void;
  selectedDocId: number | null;
  selectedFolderId: number | null;
  onSelectDoc: (docId: number) => void;
  onSelectFolder: (folderId: number | null) => void;
  onCreateFolder: (parentId: number | null) => void;
  onRenameFolder: (folder: DocFolderNode) => void;
  onMoveFolder: (folder: DocFolderNode) => void;
  onDeleteFolder: (folder: DocFolderNode) => void;
  onGenerateFolder: (folder: DocFolderNode) => void;
  onCreateDoc: (folderId: number | null) => void;
  onRenameDoc: (doc: RepoDoc) => void;
  onMoveDoc: (doc: RepoDoc) => void;
  onDeleteDoc: (doc: RepoDoc) => void;
  onGenerateDoc: (doc: RepoDoc) => void;
  busy: boolean;
}) {
  const open = expanded.has(folder.id);
  const selected = selectedFolderId === folder.id && selectedDocId === null;
  const own = docsInFolder(docs, folder.id);
  const hasChildren = folder.children.length > 0 || own.length > 0;

  return (
    <>
      <div
        className={cn(ROW_CLASS, selected ? ACTIVE_CLASS : IDLE_CLASS)}
        // Indent on the wrapper so the hover and selected background still run
        // the full width of the rail.
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(folder.id)}
              className="hover:bg-background/60 rounded"
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
          onClick={() => onSelectFolder(folder.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open && hasChildren ? (
            <FolderOpen className="size-3.5 shrink-0" />
          ) : (
            <Folder className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{folder.name}</span>
        </button>

        {/* Rolled up, so a collapsed parent still shows what's happening
            underneath it. */}
        {folder.activeCount ? (
          <span className="text-primary shrink-0 font-mono text-[10px] tabular-nums">
            {folder.activeCount}↻
          </span>
        ) : null}
        {folder.failedCount ? (
          <span className="text-destructive shrink-0 font-mono text-[10px] tabular-nums">
            {folder.failedCount}!
          </span>
        ) : null}
        {folder.totalCount ? (
          <span className="text-muted-foreground shrink-0 font-mono text-[10px] tabular-nums">
            {folder.readyCount}/{folder.totalCount}
          </span>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              className={cn(MENU_CLASS, selected && "opacity-100")}
            >
              <MoreHorizontal className="size-3.5" />
              <span className="sr-only">Actions for {folder.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onCreateDoc(folder.id)}>
              <FilePlus className="size-3.5" /> New document
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCreateFolder(folder.id)}>
              <FolderPlus className="size-3.5" /> New subfolder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!folder.totalCount}
              onSelect={() => onGenerateFolder(folder)}
            >
              <Sparkles className="size-3.5" /> Write everything in here…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRenameFolder(folder)}>
              <Pencil className="size-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMoveFolder(folder)}>
              <Folder className="size-3.5" /> Move to…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Deleting records intent only — the confirm dialog is owned by
                RepoDocsTab, because Radix unmounts this menu on select and
                would take a dialog nested inside it down with it. */}
            <DropdownMenuItem variant="destructive" onSelect={() => onDeleteFolder(folder)}>
              <Trash2 className="size-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open ? (
        <>
          {folder.children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              docs={docs}
              expanded={expanded}
              onToggle={onToggle}
              selectedDocId={selectedDocId}
              selectedFolderId={selectedFolderId}
              onSelectDoc={onSelectDoc}
              onSelectFolder={onSelectFolder}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onMoveFolder={onMoveFolder}
              onDeleteFolder={onDeleteFolder}
              onGenerateFolder={onGenerateFolder}
              onCreateDoc={onCreateDoc}
              onRenameDoc={onRenameDoc}
              onMoveDoc={onMoveDoc}
              onDeleteDoc={onDeleteDoc}
              onGenerateDoc={onGenerateDoc}
              busy={busy}
            />
          ))}
          {/* Documents after subfolders at each level. */}
          {own.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              depth={depth + 1}
              selected={selectedDocId === doc.id}
              onSelect={onSelectDoc}
              onRename={onRenameDoc}
              onMove={onMoveDoc}
              onDelete={onDeleteDoc}
              onGenerate={onGenerateDoc}
              busy={busy}
            />
          ))}
        </>
      ) : null}
    </>
  );
}

function DocRow({
  doc,
  depth,
  selected,
  onSelect,
  onRename,
  onMove,
  onDelete,
  onGenerate,
  busy,
}: {
  doc: RepoDoc;
  depth: number;
  selected: boolean;
  onSelect: (docId: number) => void;
  onRename: (doc: RepoDoc) => void;
  onMove: (doc: RepoDoc) => void;
  onDelete: (doc: RepoDoc) => void;
  onGenerate: (doc: RepoDoc) => void;
  busy: boolean;
}) {
  return (
    <div
      className={cn(ROW_CLASS, selected ? ACTIVE_CLASS : IDLE_CLASS)}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
    >
      {/* The same fixed slot the folders' triangle occupies, so a document's
          name lines up with its siblings' rather than with their chevrons. */}
      <span className="size-4 shrink-0" />

      <button
        type="button"
        onClick={() => onSelect(doc.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate">{doc.title}</span>
      </button>

      <DocStatusDot doc={doc} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            className={cn(MENU_CLASS, selected && "opacity-100")}
          >
            <MoreHorizontal className="size-3.5" />
            <span className="sr-only">Actions for {doc.title}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onGenerate(doc)}>
            <Sparkles className="size-3.5" />
            {doc.has_content ? "Rewrite…" : "Write it…"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRename(doc)}>
            <Pencil className="size-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMove(doc)}>
            <Folder className="size-3.5" /> Move to…
          </DropdownMenuItem>
          {doc.has_content && doc.download_url ? (
            <DropdownMenuItem asChild>
              {/* A plain anchor: the server already stored these bytes, so this
                  request can't fail in a way a toast would need to explain. */}
              <a href={doc.download_url}>
                <Download className="size-3.5" /> Download .md
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(doc)}>
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
