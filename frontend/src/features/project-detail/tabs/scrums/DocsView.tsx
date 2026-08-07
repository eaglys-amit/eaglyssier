import { Download, ExternalLink, FileText, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { jobBadge } from "@/components/shared/StatusBadge";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

import { FileDropZone } from "./FileDropZone";
import { useReferenceFiles } from "./useReferenceFiles";

/**
 * Reference documents for the project: the specs, notes and designs the work
 * came from.
 *
 * Useful on its own as an attachment store, and the input to AI task breakdown
 * — which is why extraction status is surfaced per row rather than hidden: a
 * document with no extractable text is stored fine but can't inform a prompt.
 */
export function DocsView({ projectId }: { projectId: number }) {
  const { files, isPending, upload, remove, reExtract } = useReferenceFiles(projectId);

  return (
    <div className="space-y-4">
      <FileDropZone busy={upload.isPending} onFiles={(chosen) => upload.mutate(chosen)} />

      {isPending ? (
        <TableSkeleton rows={4} />
      ) : !files?.length ? (
        <EmptyState
          icon={FileText}
          title="No reference documents yet"
          hint="Upload the spec, design notes or ticket export the work came from."
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
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  busy={
                    (remove.isPending && remove.variables === file.id) ||
                    (reExtract.isPending && reExtract.variables === file.id)
                  }
                  onReExtract={() => reExtract.mutate(file.id)}
                  onDelete={() => remove.mutate(file.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <Sparkles className="mt-0.5 size-4 shrink-0" />
        <span>
          AI task breakdown reads these documents to draft an epic / task / subtask tree with
          suggested estimates. That's the next phase — uploading now means it has something to
          work from.
        </span>
      </div>
    </div>
  );
}

function FileRow({
  file,
  busy,
  onReExtract,
  onDelete,
}: {
  file: ReferenceFile;
  busy: boolean;
  onReExtract: () => void;
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
