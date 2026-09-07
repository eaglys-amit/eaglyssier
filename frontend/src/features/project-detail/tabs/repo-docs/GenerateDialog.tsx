import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { ReferenceFile, RepoDoc } from "@/types/api";

import { DocumentPicker } from "../documents/DocumentPicker";

/**
 * What to write, and what to write it from.
 *
 * One dialog for all three scopes — a single document, a folder's subtree, and
 * the whole set — because the inputs are identical (extra instructions plus the
 * reference documents to feed in) and only the count and the copy differ.
 * Three near-identical dialogs would drift.
 *
 * Preview-then-write, like milestones/GenerateDialog: the count and the scope
 * are on screen before anything is queued, because a set-wide generate is
 * minutes of model time behind one click.
 */
export type GenerateTarget =
  | { kind: "doc"; doc: RepoDoc }
  | { kind: "folder"; folderId: number; folderName: string; docs: RepoDoc[] }
  | { kind: "set"; docs: RepoDoc[] };

export function GenerateDialog({
  target,
  projectId,
  files,
  contextIds,
  onContextIdsChange,
  busy,
  onOpenChange,
  onSubmit,
}: {
  /** null closes it. */
  target: GenerateTarget | null;
  projectId: number;
  files: ReferenceFile[];
  contextIds: number[];
  onContextIdsChange: (next: number[]) => void;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: {
    instructions: string | null;
    referenceFileIds: number[];
    onlyMissing: boolean;
    skipHandEdited: boolean;
  }) => void;
}) {
  const [instructions, setInstructions] = useState("");
  const [scope, setScope] = useState<"missing" | "all">("missing");

  // Reset the instructions per target, but deliberately NOT the reference
  // picks: those live in the page so writing six documents in a row doesn't
  // mean re-choosing the same specs six times.
  const targetKey = keyOf(target);
  useEffect(() => {
    if (targetKey) {
      setInstructions(
        target?.kind === "doc" ? (target.doc.instructions ?? "") : "",
      );
      setScope("missing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  if (!target) return null;

  const docs = target.kind === "doc" ? [target.doc] : target.docs;
  const single = target.kind === "doc";
  const handEdited = docs.filter((d) => d.hand_edited);
  const missing = docs.filter((d) => !d.has_content);

  const skipHandEdited = !single && scope === "all";
  const willWrite = single
    ? docs
    : (scope === "missing" ? missing : docs).filter(
        (d) => !(skipHandEdited && d.hand_edited),
      );

  const selectedChars = files
    .filter((f) => contextIds.includes(f.id))
    .reduce((sum, f) => sum + f.char_count, 0);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* flex over DialogContent's grid, so the body scrolls and the footer
          stays put — the same override milestones/GenerateDialog needs. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="truncate">{titleFor(target)}</DialogTitle>
          <DialogDescription>
            Written from this repository's commits, pull requests and summary,
            plus any reference documents you pick below.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {single && target.doc.has_content ? (
            target.doc.hand_edited ? (
              <ErrorAlert
                message={
                  "This document was edited by hand. Rewriting it replaces those edits, and they can't be recovered."
                }
              />
            ) : (
              <p className="text-muted-foreground text-xs">
                This document already has content. Rewriting replaces it.
              </p>
            )
          ) : null}

          {!single ? (
            <div className="grid gap-2">
              <Label>Scope</Label>
              <RadioGroup
                value={scope}
                onValueChange={(v) => setScope(v as "missing" | "all")}
                className="gap-2"
              >
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="missing" className="mt-0.5" />
                  <span>
                    Only documents with no content
                    <span className="text-muted-foreground">
                      {" "}
                      — {missing.length} of {docs.length}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="all" className="mt-0.5" />
                  <span>
                    Every document — replaces existing text
                    <span className="text-muted-foreground">
                      {" "}
                      — {docs.length}
                    </span>
                  </span>
                </label>
              </RadioGroup>
              {scope === "all" && handEdited.length ? (
                <p className="text-muted-foreground text-xs">
                  {handEdited.length} hand-edited document
                  {handEdited.length === 1 ? "" : "s"} will be skipped, so this
                  can't silently discard someone's edits:{" "}
                  {handEdited.map((d) => d.title).join(", ")}. Rewrite those one
                  at a time.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="gen-instructions">Extra instructions (optional)</Label>
            <Textarea
              id="gen-instructions"
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Anything the brief doesn't already say — audience, depth, things to leave out."
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Reference documents (optional)</Label>
            {files.length ? (
              <>
                <DocumentPicker
                  projectId={projectId}
                  files={files}
                  selected={contextIds}
                  onChange={onContextIdsChange}
                />
                <p className="text-muted-foreground text-xs">
                  {contextIds.length
                    ? `${contextIds.length} selected · ~${Math.round(selectedChars / 1000)}k characters of context`
                    : "Nothing selected — the repository's own history is used on its own."}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                No readable documents uploaded to this project yet. Add them on
                the Documents tab to feed specs into these write-ups.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !willWrite.length}
            onClick={() =>
              onSubmit({
                instructions: instructions.trim() || null,
                referenceFileIds: contextIds,
                onlyMissing: !single && scope === "missing",
                skipHandEdited,
              })
            }
          >
            <Sparkles className="size-4" />
            {single
              ? target.doc.has_content
                ? "Rewrite it"
                : "Write it"
              : willWrite.length
                ? `Queue ${willWrite.length} document${willWrite.length === 1 ? "" : "s"}`
                : "Nothing to write"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function keyOf(target: GenerateTarget | null): string {
  if (!target) return "";
  if (target.kind === "doc") return `doc:${target.doc.id}`;
  if (target.kind === "folder") return `folder:${target.folderId}`;
  return "set";
}

function titleFor(target: GenerateTarget): string {
  if (target.kind === "doc") {
    return target.doc.has_content
      ? `Rewrite ${target.doc.title}`
      : `Write ${target.doc.title}`;
  }
  if (target.kind === "folder") return `Write everything in ${target.folderName}`;
  return "Write the whole documentation set";
}
