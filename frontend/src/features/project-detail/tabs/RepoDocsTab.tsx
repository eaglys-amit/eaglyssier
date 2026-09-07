import { useQuery } from "@tanstack/react-query";
import {
  Database,
  FileArchive,
  FileText,
  Folder,
  Sparkles,
  SquareX,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Spinner } from "@/components/shared/Spinner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type ApiError } from "@/lib/api";
import { saveBlob, slugify } from "@/lib/download";
import { qk } from "@/lib/query-keys";
import type { ReferenceFile, Repo, RepoDoc } from "@/types/api";

import { TabShell } from "@/features/project-detail/TabShell";

import { FolderNameDialog } from "./documents/FolderNameDialog";
import { MoveToFolderDialog } from "./documents/MoveToFolderDialog";
import { useReferenceFiles } from "./documents/useReferenceFiles";
import { Breadcrumb } from "./repo-docs/Breadcrumb";
import {
  buildDocTree,
  docFolderPath,
  docsInFolder,
  setProgress,
  subtreeDocs,
  type DocFolderNode,
} from "./repo-docs/doc-tree";
import { DocPane } from "./repo-docs/DocPane";
import { DocSetTree } from "./repo-docs/DocSetTree";
import { DocTitleDialog } from "./repo-docs/DocTitleDialog";
import { GenerateDialog, type GenerateTarget } from "./repo-docs/GenerateDialog";
import { RepoPicker } from "./repo-docs/RepoPicker";
import { SuggestDocsDialog } from "./repo-docs/SuggestDocsDialog";
import { useRepoDocParams } from "./repo-docs/useRepoDocParams";
import { useRepoDocs } from "./repo-docs/useRepoDocs";

/**
 * Per-repository documentation: an AI-written document set with a folder tree,
 * a rendered preview, and a hand-editable source.
 *
 * Off the tab strip and scoped to one repository via `?repo=`, because a tab is
 * per-project and this is per-repo — a strip entry would have to be an entry per
 * repository. Entered from the Repositories panel on the Data tab, the way
 * Sprint Planning is entered from the Scrums title bar.
 *
 * Two panes, like DocumentsTab: the tree is the navigation and the right pane is
 * whichever document is open. Both read one query of the whole set, which
 * deliberately carries no markdown so a draining queue's 2s poll doesn't ship
 * every document's body over and over.
 *
 * Every dialog is owned here rather than inside the rail, because Radix unmounts
 * a DropdownMenu on select and would take a dialog nested inside it down with
 * it — the same reason FolderTree only records delete intent.
 */
export function RepoDocsTab({ projectId }: { projectId: number }) {
  const { repoId, docId, setRepoId, setDocId } = useRepoDocParams();

  const repos = useQuery({
    queryKey: qk.repos(projectId),
    queryFn: () => api.get<Repo[]>(`/projects/${projectId}/repos`),
  });

  if (repoId == null) {
    return (
      <TabShell tab="repo-docs" actions={<BackToData projectId={projectId} />}>
        <RepoPicker projectId={projectId} onPick={setRepoId} />
      </TabShell>
    );
  }

  return (
    <SetView
      // Remounted per repository, so no folder selection, dialog state or
      // expansion set can survive a switch and point at the wrong repo's rows.
      key={repoId}
      projectId={projectId}
      repoId={repoId}
      docId={docId}
      repos={repos.data ?? []}
      setRepoId={setRepoId}
      setDocId={setDocId}
    />
  );
}

function BackToData({ projectId }: { projectId: number }) {
  return (
    // A button rather than PageHeader's `backTo`, which would suppress the
    // page's description line — and this way the trip out and back match.
    <Button asChild size="sm" variant="outline">
      <Link to={`/projects/${projectId}/data`}>
        <Database className="size-4" /> Data
      </Link>
    </Button>
  );
}

type Naming =
  | { kind: "folder"; mode: "create"; parentId: number | null; parentName?: string }
  | { kind: "folder"; mode: "rename"; folder: DocFolderNode }
  | { kind: "doc"; mode: "create"; folderId: number | null; folderName?: string }
  | { kind: "doc"; mode: "rename"; doc: RepoDoc }
  | null;

type Moving =
  | { kind: "folder"; folder: DocFolderNode }
  | { kind: "doc"; doc: RepoDoc }
  | null;

type Deleting =
  | { kind: "folder"; folder: DocFolderNode }
  | { kind: "doc"; doc: RepoDoc }
  | null;

function SetView({
  projectId,
  repoId,
  docId,
  repos,
  setRepoId,
  setDocId,
}: {
  projectId: number;
  repoId: number;
  docId: number | null;
  repos: Repo[];
  setRepoId: (id: number | null) => void;
  setDocId: (id: number | null) => void;
}) {
  const {
    set,
    isLoading,
    error,
    seed,
    createFolder,
    updateFolder,
    deleteFolder,
    createDoc,
    updateDoc,
    deleteDoc,
    generateDoc,
    generateAll,
    cancelAll,
  } = useRepoDocs(projectId, repoId);

  const [folderId, setFolderId] = useState<number | null>(null);
  const [naming, setNaming] = useState<Naming>(null);
  const [moving, setMoving] = useState<Moving>(null);
  const [deleting, setDeleting] = useState<Deleting>(null);
  const [generating, setGenerating] = useState<GenerateTarget | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [leavingTo, setLeavingTo] = useState<number | null>(null);

  // The reference documents fed to generation. Lifted to the page, not the
  // dialog, so writing six documents in a row doesn't mean re-picking the same
  // six specs each time.
  const [contextIds, setContextIds] = useState<number[]>([]);
  const { files } = useReferenceFiles(projectId);
  // Only documents with extractable text can inform a prompt — BreakdownPanel's
  // exact filter.
  const usableFiles: ReferenceFile[] = (files ?? []).filter(
    (f) => f.extract_status === "ready" && f.char_count > 0,
  );

  // The open pane publishes its dirty flag through a ref: parent state would
  // re-render the pane, and therefore the textarea, on every keystroke.
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((next: boolean) => {
    dirtyRef.current = next;
  }, []);

  const folders = set?.folders ?? [];
  const docs = set?.docs ?? [];
  const roots = useMemo(() => buildDocTree(folders, docs), [folders, docs]);
  const progress = setProgress(set);

  const repo = repos.find((r) => r.id === repoId);
  const repoName = set?.repo_name ?? repo?.name ?? `Repository ${repoId}`;
  const selectedDoc = docId != null ? docs.find((d) => d.id === docId) : undefined;
  // A ?doc= that isn't in the loaded set — a stale deep link, or a document
  // deleted in another tab. Say so rather than showing an empty pane with a
  // breadcrumb that goes nowhere.
  const docMissing = docId != null && set != null && !selectedDoc;

  const seeded = set?.seeded_at != null;
  const busy = createFolder.isPending || updateFolder.isPending || deleteFolder.isPending;

  /**
   * Selecting another document is a `?doc=` change, so react-router's
   * useBlocker never sees it — the guard has to sit on the click. Confirm
   * first, then navigate: the other order unmounts the draft before we ask.
   */
  const selectDoc = (id: number) => {
    if (dirtyRef.current && id !== docId) setLeavingTo(id);
    else setDocId(id);
  };

  const archive = async () => {
    try {
      const blob = await api.blob(`/repos/${repoId}/doc-set/archive`);
      saveBlob(blob, `${slugify(repoName)}-docs.zip`);
      if (progress.missing) {
        toast.success(
          `Archived ${progress.ready} document${progress.ready === 1 ? "" : "s"} — ${progress.missing} have no content yet and were skipped`,
        );
      }
    } catch (err) {
      toast.error((err as ApiError).detail || "Could not build the archive");
    }
  };

  return (
    <TabShell
      tab="repo-docs"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <BackToData projectId={projectId} />

          <Select value={String(repoId)} onValueChange={(v) => setRepoId(Number(v))}>
            <SelectTrigger size="sm" className="w-[16rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {repos.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {seeded ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setSuggestOpen(true)}>
                <Sparkles className="size-4" /> Suggest more
              </Button>

              {progress.active ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancelAll.isPending}
                  onClick={() => cancelAll.mutate()}
                >
                  <SquareX className="size-4" /> Stop ({progress.active})
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!docs.length}
                  onClick={() => setGenerating({ kind: "set", docs })}
                >
                  <Sparkles className="size-4" /> Write all
                </Button>
              )}

              <Button
                size="sm"
                variant="ghost"
                disabled={!progress.total}
                title={
                  progress.missing
                    ? `${progress.missing} document(s) have no content yet and will be skipped`
                    : "Download the whole set as a .zip"
                }
                onClick={archive}
              >
                <FileArchive className="size-4" /> .zip
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      {error ? <ErrorAlert message={error.detail} /> : null}

      {isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Loading the documentation set…
        </div>
      ) : !seeded ? (
        <EmptyState
          icon={FileText}
          title="No documentation set yet"
          hint={`Create the standard set for ${repoName}: requirements and API design, roadmap and dependency review, test plan and security assessment, release notes and CI/CD runbook. Each one is written from this repository's own history, and you can add more afterwards.`}
          action={
            <Button size="sm" disabled={seed.isPending} onClick={() => seed.mutate(false)}>
              <FileText className="size-4" />
              {seed.isPending ? "Setting up…" : "Create the standard set"}
            </Button>
          }
        />
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
          <div className="min-h-0 shrink-0 lg:h-full lg:w-72">
            <DocSetTree
              roots={roots}
              folders={folders}
              docs={docs}
              selectedDocId={docId}
              selectedFolderId={folderId}
              onSelectDoc={selectDoc}
              onSelectFolder={(id) => {
                setFolderId(id);
                setDocId(null);
              }}
              onCreateFolder={(parentId) =>
                setNaming({
                  kind: "folder",
                  mode: "create",
                  parentId,
                  parentName: folders.find((f) => f.id === parentId)?.name,
                })
              }
              onRenameFolder={(folder) =>
                setNaming({ kind: "folder", mode: "rename", folder })
              }
              onMoveFolder={(folder) => setMoving({ kind: "folder", folder })}
              onDeleteFolder={(folder) => setDeleting({ kind: "folder", folder })}
              onGenerateFolder={(folder) =>
                setGenerating({
                  kind: "folder",
                  folderId: folder.id,
                  folderName: folder.name,
                  // subtreeDocs already covers the folder's own documents as
                  // well as everything beneath it.
                  docs: subtreeDocs(docs, folder),
                })
              }
              onCreateDoc={(id) =>
                setNaming({
                  kind: "doc",
                  mode: "create",
                  folderId: id,
                  folderName: folders.find((f) => f.id === id)?.name,
                })
              }
              onRenameDoc={(doc) => setNaming({ kind: "doc", mode: "rename", doc })}
              onMoveDoc={(doc) => setMoving({ kind: "doc", doc })}
              onDeleteDoc={(doc) => setDeleting({ kind: "doc", doc })}
              onGenerateDoc={(doc) => setGenerating({ kind: "doc", doc })}
              busy={busy}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <Breadcrumb
                repoName={repoName}
                provider={repo?.provider}
                path={docFolderPath(folders, selectedDoc?.folder_id ?? folderId)}
                doc={selectedDoc}
                onRoot={() => {
                  setFolderId(null);
                  setDocId(null);
                }}
                onFolder={(id) => {
                  setFolderId(id);
                  setDocId(null);
                }}
              />
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {progress.ready}/{progress.total} written
                {progress.active ? ` · ${progress.active} in flight` : ""}
                {progress.failed ? ` · ${progress.failed} failed` : ""}
              </span>
            </div>

            {docMissing ? (
              <EmptyState
                icon={FileText}
                title="That document no longer exists"
                hint="It may have been deleted, or the link points at another repository. Pick one from the tree."
              />
            ) : selectedDoc ? (
              <DocPane
                // Remounted per document, so `dirty` and `draft` cannot follow
                // the user from one document to the next and get saved onto the
                // wrong one — the same reason EvaluationSheetEditor is keyed by
                // member.
                key={selectedDoc.id}
                summary={selectedDoc}
                repoId={repoId}
                onDirtyChange={onDirtyChange}
                onGenerate={(doc) => setGenerating({ kind: "doc", doc })}
              />
            ) : (
              <FolderOverview
                folderId={folderId}
                folders={folders}
                docs={docs}
                onOpen={selectDoc}
              />
            )}
          </div>
        </div>
      )}

      {/* ---- dialogs, all owned here (see the note at the top) ---- */}

      {naming?.kind === "folder" ? (
        <FolderNameDialog
          open
          onOpenChange={(o) => !o && setNaming(null)}
          currentName={naming.mode === "rename" ? naming.folder.name : undefined}
          parentName={naming.mode === "create" ? naming.parentName : undefined}
          busy={createFolder.isPending || updateFolder.isPending}
          onSubmit={(name) => {
            if (naming.mode === "create") {
              createFolder.mutate(
                { name, parent_id: naming.parentId },
                { onSuccess: () => setNaming(null) },
              );
            } else {
              updateFolder.mutate(
                { folderId: naming.folder.id, name },
                { onSuccess: () => setNaming(null) },
              );
            }
          }}
        />
      ) : null}

      {naming?.kind === "doc" ? (
        <DocTitleDialog
          open
          onOpenChange={(o) => !o && setNaming(null)}
          currentTitle={naming.mode === "rename" ? naming.doc.title : undefined}
          currentGuidance={naming.mode === "rename" ? naming.doc.guidance : undefined}
          folderName={naming.mode === "create" ? naming.folderName : undefined}
          busy={createDoc.isPending || updateDoc.isPending}
          onSubmit={({ title, guidance }) => {
            if (naming.mode === "create") {
              createDoc.mutate(
                { title, folder_id: naming.folderId, guidance },
                {
                  onSuccess: (row) => {
                    setNaming(null);
                    setDocId(row.id);
                  },
                },
              );
            } else {
              updateDoc.mutate(
                { docId: naming.doc.id, title, guidance },
                { onSuccess: () => setNaming(null) },
              );
            }
          }}
        />
      ) : null}

      {moving ? (
        <MoveToFolderDialog
          open
          onOpenChange={(o) => !o && setMoving(null)}
          title={
            moving.kind === "folder"
              ? `Move ${moving.folder.name}`
              : `Move ${moving.doc.title}`
          }
          roots={roots}
          allFolders={folders}
          rootLabel="Repository root"
          rootIcon={Folder}
          currentFolderId={
            moving.kind === "folder" ? moving.folder.parent_id : moving.doc.folder_id
          }
          movingFolderId={moving.kind === "folder" ? moving.folder.id : undefined}
          busy={updateFolder.isPending || updateDoc.isPending}
          onMove={(target) => {
            // parent_id / folder_id are sent explicitly INCLUDING null: an
            // absent field means "leave it where it is" server-side, so
            // omitting it would make "move to the root" a silent no-op.
            if (moving.kind === "folder") {
              updateFolder.mutate(
                { folderId: moving.folder.id, parent_id: target },
                { onSuccess: () => setMoving(null) },
              );
            } else {
              updateDoc.mutate(
                { docId: moving.doc.id, folder_id: target },
                { onSuccess: () => setMoving(null) },
              );
            }
          }}
        />
      ) : null}

      {deleting?.kind === "folder" ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete ${deleting.folder.name}?`}
          // Both halves stated, because they differ — and copying the Documents
          // tab's wording without checking the rule would be a lie.
          description={
            deleting.folder.totalCount
              ? `Its subfolders go with it. The ${deleting.folder.totalCount} document(s) inside are kept and move to the repository root — nothing written is lost.`
              : "Its subfolders go with it. Nothing written is lost."
          }
          onConfirm={() => {
            deleteFolder.mutate(deleting.folder.id);
            if (folderId === deleting.folder.id) setFolderId(null);
            setDeleting(null);
          }}
        />
      ) : null}

      {deleting?.kind === "doc" ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete ${deleting.doc.title}?`}
          description={
            deleting.doc.has_content
              ? "Its text is deleted with it and cannot be recovered. You can regenerate a document with the same name afterwards."
              : "It has no content yet, so nothing is lost."
          }
          onConfirm={() => {
            deleteDoc.mutate(deleting.doc.id);
            if (docId === deleting.doc.id) setDocId(null);
            setDeleting(null);
          }}
        />
      ) : null}

      <GenerateDialog
        target={generating}
        projectId={projectId}
        files={usableFiles}
        contextIds={contextIds}
        onContextIdsChange={setContextIds}
        busy={generateAll.isPending || generateDoc.isPending}
        onOpenChange={(o) => !o && setGenerating(null)}
        onSubmit={({ instructions, referenceFileIds, onlyMissing, skipHandEdited }) => {
          if (generating?.kind === "doc") {
            const id = generating.doc.id;
            generateDoc.mutate(
              {
                docId: id,
                instructions,
                reference_file_ids: referenceFileIds,
              },
              {
                onSuccess: () => {
                  // Open it, so there is somewhere to watch it being written.
                  setDocId(id);
                  setGenerating(null);
                },
              },
            );
            return;
          }
          generateAll.mutate(
            {
              instructions,
              reference_file_ids: referenceFileIds,
              only_missing: onlyMissing,
              skip_hand_edited: skipHandEdited,
              folder_id: generating?.kind === "folder" ? generating.folderId : null,
            },
            { onSuccess: () => setGenerating(null) },
          );
        }}
      />

      <SuggestDocsDialog repoId={repoId} open={suggestOpen} onOpenChange={setSuggestOpen} />

      {leavingTo != null ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setLeavingTo(null)}
          title="Discard your unsaved edits?"
          description="You have changes in the editor that haven't been saved. Opening another document loses them."
          confirmLabel="Discard and open"
          onConfirm={() => {
            dirtyRef.current = false;
            setDocId(leavingTo);
            setLeavingTo(null);
          }}
        />
      ) : null}
    </TabShell>
  );
}

/** A folder's contents, when a folder is selected but no document is open. */
function FolderOverview({
  folderId,
  folders,
  docs,
  onOpen,
}: {
  folderId: number | null;
  folders: { id: number; name: string }[];
  docs: RepoDoc[];
  onOpen: (docId: number) => void;
}) {
  const own = docsInFolder(docs, folderId);
  const name = folders.find((f) => f.id === folderId)?.name ?? "the repository root";

  if (!own.length) {
    return (
      <EmptyState
        icon={Folder}
        title={`Nothing filed in ${name}`}
        hint="Pick a document from the tree, or add one to this folder."
      />
    );
  }

  return (
    <div className="bg-card min-h-0 flex-1 overflow-y-auto rounded-lg border p-2">
      {own.map((doc) => (
        <button
          key={doc.id}
          type="button"
          onClick={() => onOpen(doc.id)}
          className="hover:bg-accent/50 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left"
        >
          <FileText className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{doc.title}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {doc.summary ??
                (doc.has_content ? "Written" : "Not generated yet")}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
