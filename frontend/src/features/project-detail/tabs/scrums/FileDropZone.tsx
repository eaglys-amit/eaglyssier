import { Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/shared/Spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ACCEPT, MAX_BYTES, validateFiles } from "./file-rules";

/**
 * Drag-and-drop upload with a real button behind it.
 *
 * The drop zone is a convenience, not the affordance: a div you can only drop
 * onto is unreachable by keyboard, so the button is what's actually labelled and
 * focusable, and the file input stays a real input.
 */
export function FileDropZone({
  busy,
  onFiles,
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragleave also fires when the pointer crosses onto a CHILD element, so a
  // plain boolean strobes as you move over the icon and the text. Count enters
  // and leaves instead.
  const depth = useRef(0);

  const take = (list: FileList | null) => {
    const { accepted, rejected } = validateFiles([...(list ?? [])]);
    for (const r of rejected) toast.error(`${r.file.name} — ${r.reason}`);
    if (accepted.length) onFiles(accepted);
  };

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Upload className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">Drop reference documents here</div>
      <div className="max-w-sm text-xs text-muted-foreground">
        Markdown, plain text, HTML or PDF, up to {MAX_BYTES / 1_000_000} MB each. Their text
        becomes the context for AI task breakdown.
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-1"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Spinner /> : <Plus className="size-4" />}
        {busy ? "Uploading…" : "Choose files"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        // Reset the value so re-picking the same file fires change again.
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
