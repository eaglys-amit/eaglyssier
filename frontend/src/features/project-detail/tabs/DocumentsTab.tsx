import {
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  FolderInput,
  Library,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { jobBadge } from "@/components/shared/StatusBadge";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatDate } from "@/lib/format";
import type { ReferenceFile } from "@/types/api";

import { TabShell } from "@/features/project-detail/TabShell";

import { FileDropZone } from "./documents/FileDropZone";
import { buildFolderTree, filesInFolder, folderPath, type FolderNode } from "./documents/folder-tree";
import { FolderNameDialog } from "./documents/FolderNameDialog";
import { FolderTree } from "./documents/FolderTree";
import { MoveToFolderDialog } from "./documents/MoveToFolderDialog";
import { useDocumentParams } from "./documents/useDocumentParams";
import { useReferenceFiles } from "./documents/useReferenceFiles";
import { useReferenceFolders } from "./documents/useReferenceFolders";

/**
 * Reference documents for the project: the specs, notes and designs the work
 * came from.
 *
 * Project-scoped, not sprint-scoped, which is why this is a tab of its own
 * rather than a corner of Scrums — the same document informs planning, a task's
 * attachments, and a report. Useful on its own as an attachment store, and the
 * input to the AI breakdown over in Scrums — which is why extraction status is
 * surfaced per row rather than hidden: a document with no extractable text is
 * stored fine but can't inform a prompt.
 *
 * Two panes: the folder rail is the navigation, the table is the contents of
 * whichever folder is selected. Both read one query of every document in the
 * project (see useReferenceFiles) — the rail needs the whole set to count
 * subtrees, so filtering in memory beats a fetch per folder click.
 */
export function DocumentsTab({ projectId }: { projectId: number }) {
  const { folderId, setFolderId } = useDocumentParams();
  const { files, isPending, upload, remove, reExtract, move } = useReferenceFiles(projectId);
  const folders = useReferenceFolders(projectId);

  // Which dialog is open, and on what. One piece of state rather than three
  // booleans: only one of these can be open at a time, and a null target is
  // exactly what "closed" means.
  const [naming, setNaming] = useState<
    { mode: "create"; parentId: number | null } | { mode: "rename"; folder: FolderNode } | null
  >(null);
  const [movingFolder, setMovingFolder] = useState<FolderNode | null>(null);
  const [movingFile, setMovingFile] = useState<ReferenceFile | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<FolderNode | null>(null);

  const all = files ?? [];
  const folderRows = folders.folders ?? [];
  const roots = useMemo(() => buildFolderTree(folderRows, all), [folderRows, all]);
  const path = useMemo(() => folderPath(folderRows, folderId), [folderRows, folderId]);

  // A folder that no longer exists — deleted in another tab, or a stale link —
  // reads as the root rather than as an empty folder with a broken breadcrumb.
  const missing = folderId !== null && !folders.isPending && !path.length;
  const currentId = missing ? null : folderId;
  const visible = filesInFolder(all, currentId);
  const here = path.at(-1) ?? null;

  const busy = folders.create.isPending || folders.rename.isPending || folders.move.isPending;

  return (
    <TabShell tab="documents">
      <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
        {/* Fixed rail: the table is the part that deserves the spare width. */}
        <div className="min-h-0 shrink-0 lg:h-full lg:w-64">
          <FolderTree
            roots={roots}
            rootCount={filesInFolder(all, null).length}
            selectedId={currentId}
            onSelect={setFolderId}
            onCreate={(parentId) => setNaming({ mode: "create", parentId })}
            onRename={(folder) => setNaming({ mode: "rename", folder })}
            onMove={setMovingFolder}
            onDelete={setDeletingFolder}
            busy={busy}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:overflow-y-auto">
          <Breadcrumb path={path} onSelect={setFolderId} />

          <FileDropZone
            busy={upload.isPending}
            folderName={here?.name ?? null}
            onFiles={(chosen) => upload.mutate({ files: chosen, folderId: currentId })}
          />

          {isPending ? (
            <TableSkeleton rows={4} />
          ) : !visible.length ? (
            <EmptyState
              icon={FileText}
              title={here ? `${here.name} is empty` : "No reference documents yet"}
              hint={
                here
                  ? "Drop files here to file them in this folder, or move existing ones in."
                  : "Upload the spec, design notes or ticket export the work came from."
              }
            />
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead className="w-20">Type</TableHead>
                    <TableHead className="w-24 text-right">Size</TableHead>
                    <TableHead className="w-40">Extracted text</TableHead>
                    <TableHead className="w-28">Uploaded</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      busy={
                        (remove.isPending && remove.variables === file.id) ||
                        (reExtract.isPending && reExtract.variables === file.id) ||
                        (move.isPending && move.variables?.fileId === file.id)
                      }
                      onReExtract={() => reExtract.mutate(file.id)}
                      onMove={() => setMovingFile(file)}
                      onDelete={() => remove.mutate(file.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <FolderNameDialog
        open={naming !== null}
        onOpenChange={(open) => !open && setNaming(null)}
        currentName={naming?.mode === "rename" ? naming.folder.name : null}
        parentName={
          naming?.mode === "create" && naming.parentId != null
            ? folderRows.find((f) => f.id === naming.parentId)?.name ?? null
            : null
        }
        busy={busy}
        onSubmit={(name) => {
          if (naming?.mode === "rename") {
            folders.rename.mutate({ folderId: naming.folder.id, name });
          } else if (naming) {
            folders.create.mutate({ name, parentId: naming.parentId });
          }
          setNaming(null);
        }}
      />

      <MoveToFolderDialog
        open={movingFolder !== null}
        onOpenChange={(open) => !open && setMovingFolder(null)}
        title={`Move ${movingFolder?.name ?? ""}`}
        roots={roots}
        allFolders={folderRows}
        currentFolderId={movingFolder?.parent_id ?? null}
        movingFolderId={movingFolder?.id}
        busy={folders.move.isPending}
        onMove={(parentId) => {
          if (movingFolder) folders.move.mutate({ folderId: movingFolder.id, parentId });
          setMovingFolder(null);
        }}
      />

      {/* Spells out both halves of the delete rule, because they differ: the
          subfolders go, the documents don't. */}
      <ConfirmDialog
        open={deletingFolder !== null}
        onOpenChange={(open) => !open && setDeletingFolder(null)}
        title={`Delete ${deletingFolder?.name ?? ""}?`}
        description={
          deletingFolder
            ? `Any subfolders are deleted too. The ${deletingFolder.totalCount} document(s) inside are kept and move to All documents.`
            : undefined
        }
        onConfirm={() => {
          if (deletingFolder) {
            folders.remove.mutate(deletingFolder.id);
            // The open folder would otherwise become a dangling ?folder=.
            if (currentId === deletingFolder.id) setFolderId(null);
          }
          setDeletingFolder(null);
        }}
      />

      <MoveToFolderDialog
        open={movingFile !== null}
        onOpenChange={(open) => !open && setMovingFile(null)}
        title={`Move ${movingFile?.filename ?? ""}`}
        roots={roots}
        allFolders={folderRows}
        currentFolderId={movingFile?.folder_id ?? null}
        busy={move.isPending}
        onMove={(destination) => {
          if (movingFile) move.mutate({ fileId: movingFile.id, folderId: destination });
          setMovingFile(null);
        }}
      />
    </TabShell>
  );
}

/** Root → current folder. Every step is a link back up. */
function Breadcrumb({
  path,
  onSelect,
}: {
  path: Array<{ id: number; name: string }>;
  onSelect: (folderId: number | null) => void;
}) {
  return (
    <nav className="flex min-w-0 items-center gap-0.5 text-sm">
      <Button variant="ghost" size="xs" className="gap-1.5" onClick={() => onSelect(null)}>
        <Library className="size-3.5" />
        All documents
      </Button>
      {path.map((folder, i) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <Button
            variant="ghost"
            size="xs"
            // The last crumb is where you already are, so it reads as a label.
            className={i === path.length - 1 ? "font-medium" : "text-muted-foreground"}
            onClick={() => onSelect(folder.id)}
          >
            <span className="truncate">{folder.name}</span>
          </Button>
        </span>
      ))}
    </nav>
  );
}

function FileRow({
  file,
  busy,
  onReExtract,
  onMove,
  onDelete,
}: {
  file: ReferenceFile;
  busy: boolean;
  onReExtract: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  // A stored file with zero characters isn't a failure — the upload worked — but
  // it is useless as prompt context, so it reads as a warning rather than "Ready".
  const noText = file.extract_status === "ready" && file.char_count === 0;

  return (
    <TableRow>
      <TableCell className="max-w-0">
        <span className="block truncate font-medium">{file.filename}</span>
        {file.extract_error ? (
          <span className="block truncate text-xs text-destructive">{file.extract_error}</span>
        ) : null}
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="font-mono text-[10px] uppercase">
          {file.kind}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {formatBytes(file.size_bytes)}
      </TableCell>
      <TableCell>
        {noText ? (
          <span className="text-xs text-warning">No text found</span>
        ) : (
          <span className="flex items-center gap-2">
            {jobBadge(file.extract_status, { ready: "Ready", none: "Not read" })}
            {file.char_count > 0 ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {file.char_count.toLocaleString()}
              </span>
            ) : null}
          </span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(file.created_at)}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-0.5">
          {file.view_url ? (
            <Button asChild variant="ghost" size="icon-sm">
              <a href={file.view_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                <span className="sr-only">View {file.filename}</span>
              </a>
            </Button>
          ) : null}
          {file.download_url ? (
            <Button asChild variant="ghost" size="icon-sm">
              <a href={file.download_url} download>
                <Download className="size-3.5" />
                <span className="sr-only">Download {file.filename}</span>
              </a>
            </Button>
          ) : null}
          {file.extract_status === "failed" || noText ? (
            <Button variant="ghost" size="icon-sm" disabled={busy} onClick={onReExtract}>
              <RefreshCw className="size-3.5" />
              <span className="sr-only">Re-read {file.filename}</span>
            </Button>
          ) : null}
          {/* Move and delete share a menu: two more icon buttons per row would
              crowd out the ones that act on the document itself. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={busy}>
                <MoreHorizontal className="size-3.5" />
                <span className="sr-only">More actions for {file.filename}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onMove}>
                <FolderInput className="size-3.5" /> Move to…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                <Trash2 className="size-3.5" />
                <span className="sr-only">Delete {file.filename}</span>
              </Button>
            }
            title={`Delete ${file.filename}?`}
            description="The stored file is removed. Any AI breakdown that used it keeps its draft, but the document won't be available to re-run one."
            onConfirm={onDelete}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
