import { RefreshCw, Save, Undo2 } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * The markdown source, hand-editable.
 *
 * Presentational: the draft, the dirty flag and the base rev all live in
 * DocPane, which owns the clobber guards. This is the textarea plus the two
 * things the user can do with it.
 */
export function DocEditor({
  value,
  dirty,
  saving,
  /** A generation landed on the server while these edits were unsaved. */
  stale,
  onChange,
  onSave,
  onRevert,
}: {
  value: string;
  dirty: boolean;
  saving: boolean;
  stale: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
  onRevert: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {stale ? (
        <div className="border-warning/40 bg-warning/10 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
          <span>
            This document was rewritten on the server while you had unsaved edits.
            Reload to see the new version and lose yours, or save to keep yours.
          </span>
          {/* Reload is entirely `setDirty(false)` in the parent: that re-arms
              the seed effect, which already has fresh data in cache. */}
          <Button size="sm" variant="outline" className="shrink-0" onClick={onRevert}>
            <RefreshCw className="size-4" /> Reload
          </Button>
        </div>
      ) : null}

      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        // field-sizing-content (see ui/textarea.tsx) grows the box to fit its
        // content, which for a 2,000-line document means the pane never scrolls
        // and Save ends up below the fold. Fixed height with its own scroll.
        className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed [field-sizing:fixed]"
        onKeyDown={(e) => {
          // Markdown lists need real indentation, and Tab would otherwise leave
          // the textarea. Shift+Tab is left alone so there is still a way out.
          if (e.key !== "Tab" || e.shiftKey) return;
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: start, selectionEnd: end } = el;
          onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = start + 2;
          });
        }}
      />

      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty || saving}
          onClick={onRevert}
        >
          <Undo2 className="size-4" /> Revert
        </Button>
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          <Save className="size-4" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
