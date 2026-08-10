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

/**
 * Name a new folder, or rename one. FormData on submit, like SprintDialog.
 *
 * Deliberately no client-side duplicate check: the server already rejects a
 * clashing sibling name with a message that names the folder in the way, and
 * duplicating that rule here would give two places to keep in step.
 */
export function FolderNameDialog({
  open,
  onOpenChange,
  /** Renaming when present; the current name seeds the field. */
  currentName,
  /** Shown when creating, to say where the folder will land. */
  parentName,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName?: string | null;
  parentName?: string | null;
  busy: boolean;
  onSubmit: (name: string) => void;
}) {
  const renaming = currentName != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{renaming ? `Rename ${currentName}` : "New folder"}</DialogTitle>
          {!renaming ? (
            <DialogDescription>
              {parentName ? `Inside ${parentName}.` : "At the top level."}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <form
          // Remount per target so the defaultValue follows whichever folder the
          // menu was opened from, rather than sticking at the first one.
          key={currentName ?? "new"}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            if (name) onSubmit(name);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              name="name"
              required
              autoFocus
              maxLength={255}
              defaultValue={currentName ?? ""}
              placeholder="Specs"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {renaming ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
