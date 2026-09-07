import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Name a new document, or rename one. FormData on submit, like FolderNameDialog.
 *
 * No client-side duplicate check, for the same reason: the server already
 * rejects a clashing title with a message that names the document in the way,
 * and duplicating that rule here would give two places to keep in step.
 */
export function DocTitleDialog({
  open,
  onOpenChange,
  currentTitle,
  currentGuidance,
  folderName,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renaming when present; the current title seeds the field. */
  currentTitle?: string | null;
  currentGuidance?: string | null;
  /** Shown when creating, to say where the document will land. */
  folderName?: string | null;
  busy: boolean;
  onSubmit: (values: { title: string; guidance: string | null }) => void;
}) {
  const renaming = currentTitle != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">
            {renaming ? `Rename ${currentTitle}` : "New document"}
          </DialogTitle>
          <DialogDescription>
            {renaming
              ? "The stored file keeps its place; only the name and brief change."
              : folderName
                ? `Inside ${folderName}. It starts empty — generate it afterwards.`
                : "At the root of the set. It starts empty — generate it afterwards."}
          </DialogDescription>
        </DialogHeader>

        <form
          // Remount per target so the defaults follow whichever document the
          // menu was opened from rather than sticking at the first one.
          key={currentTitle ?? "new"}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const title = String(data.get("title") ?? "").trim();
            const guidance = String(data.get("guidance") ?? "").trim();
            if (title) onSubmit({ title, guidance: guidance || null });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              name="title"
              required
              autoFocus
              maxLength={512}
              defaultValue={currentTitle ?? ""}
              placeholder="Data_Model_Reference"
            />
            <p className="text-muted-foreground text-xs">
              Underscore_Case, like the built-in documents. This also becomes the
              filename in the download and the .zip.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="doc-guidance">What it must contain</Label>
            <Textarea
              id="doc-guidance"
              name="guidance"
              rows={4}
              defaultValue={currentGuidance ?? ""}
              placeholder={
                "The sections this document needs, and which mermaid diagrams belong in it — or that none do."
              }
            />
            <p className="text-muted-foreground text-xs">
              This is the brief handed to the model when the document is written.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {renaming ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
