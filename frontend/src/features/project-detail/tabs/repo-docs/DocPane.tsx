import {
  Download,
  Eye,
  FileText,
  Pencil,
  Sparkles,
  SquareX,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { EmptyState } from "@/components/shared/EmptyState";
import { Markdown } from "@/components/shared/Markdown";
import { Spinner } from "@/components/shared/Spinner";
import { jobBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RepoDoc } from "@/types/api";

import { isActive } from "./doc-tree";
import { DocEditor } from "./DocEditor";
import { useRepoDoc } from "./useRepoDoc";

/**
 * One document: its header, its rendered markdown, and its source.
 *
 * Mounted with `key={doc.id}` by RepoDocsTab, which is load-bearing — see the
 * dirty-state note below.
 *
 * Preview and Edit are separate tabs rather than a live split pane for two
 * reasons: the content column is already narrow next to the rail, and
 * re-parsing a 100KB document (plus re-rendering every Mermaid diagram in it)
 * on each keystroke is a real jank source.
 */
export function DocPane({
  summary,
  repoId,
  onDirtyChange,
  onGenerate,
}: {
  /** The row from the set query, so the header renders before the body loads. */
  summary: RepoDoc;
  repoId: number;
  onDirtyChange: (dirty: boolean) => void;
  onGenerate: (doc: RepoDoc) => void;
}) {
  // `generate` is deliberately not used here: every generate goes through
  // RepoDocsTab's dialog, so the instructions box and the reference-document
  // picker are the same ones the folder- and set-level flows use.
  const { doc, isLoading, error, cancel, save } = useRepoDoc(
    summary.id,
    repoId,
  );
  const [view, setView] = useState<"preview" | "edit">("preview");

  const [draft, setDraft] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // The rev the draft was seeded from. Sent on save so the server can 409
  // rather than let an edit overwrite a generation that landed meanwhile.
  const [baseRev, setBaseRev] = useState<number | null>(null);

  // Seed the editable copy whenever the server has something newer AND the user
  // has no unsaved edits.
  //
  // This `!dirty` guard is what makes BOTH the 2s poll and the global
  // refetchOnWindowFocus safe. The focus refetch is the one that actually bites:
  // main.tsx enables it with a 30s staleTime, so tabbing away to read a spec and
  // coming back refetches this query regardless of any poll config, and an
  // unguarded seed would silently replace whatever the user had typed.
  useEffect(() => {
    if (doc && !dirty) {
      setDraft(doc.markdown ?? "");
      setBaseRev(doc.rev);
    }
  }, [doc, dirty]);

  // Published upward through a callback rather than lifted into the parent's
  // state: parent state would re-render this pane — and the textarea — on every
  // keystroke.
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // The browser-close case. The tab-switch and document-switch cases are
  // handled in RepoDocsTab, which owns navigation.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const row = doc ?? summary;
  const active = isActive(row.status);
  const staleDraft = dirty && doc != null && baseRev != null && doc.rev !== baseRev;
  const body = draft ?? doc?.markdown ?? "";

  return (
    <div className="bg-card flex min-h-0 flex-1 flex-col rounded-lg border">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <FileText className="text-muted-foreground size-4 shrink-0" />
        <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight">
          {row.title}
        </h2>
        {active || row.status === "failed" ? jobBadge(row.status) : null}
        {row.hand_edited ? (
          <span className="text-muted-foreground text-xs">edited by hand</span>
        ) : null}
        {row.model && !active ? (
          <span className="text-muted-foreground truncate text-xs">{row.model}</span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Tabs value={view} onValueChange={(v) => setView(v as "preview" | "edit")}>
            <TabsList variant="line">
              <TabsTrigger value="preview">
                <Eye className="size-3.5" /> Preview
              </TabsTrigger>
              <TabsTrigger value="edit">
                <Pencil className="size-3.5" /> Edit
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {active ? (
            <Button size="sm" variant="outline" onClick={() => cancel.mutate()}>
              <SquareX className="size-4" /> Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              // Regeneration overwrites the content server-side, so offering it
              // beside unsaved text is offering to throw that text away.
              disabled={dirty}
              title={dirty ? "Save your edits first" : undefined}
              onClick={() => onGenerate(row)}
            >
              <Sparkles className="size-4" />
              {row.has_content ? "Rewrite" : "Write it"}
            </Button>
          )}

          {row.has_content && row.download_url ? (
            <Button asChild size="icon-sm" variant="ghost" title="Download .md">
              <a href={row.download_url}>
                <Download className="size-3.5" />
                <span className="sr-only">Download {row.title} as markdown</span>
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {row.status === "failed" && row.error ? (
          <div className="mb-3">
            <ErrorAlert message={row.error} />
          </div>
        ) : null}

        {error ? <ErrorAlert message={error.detail} /> : null}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : view === "edit" ? (
          <div className="flex h-full min-h-0 flex-col">
            <DocEditor
              value={body}
              dirty={dirty}
              saving={save.isPending}
              stale={staleDraft}
              onChange={(next) => {
                setDraft(next);
                setDirty(true);
              }}
              onSave={() =>
                save.mutate(
                  { markdown: body, base_rev: baseRev ?? row.rev },
                  { onSuccess: () => setDirty(false) },
                )
              }
              // Discarding the draft is exactly "stop being dirty": the seed
              // effect above then re-runs over the data already in cache.
              onRevert={() => setDirty(false)}
            />
          </div>
        ) : active && !body ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {row.status === "queued"
              ? "Waiting for its turn in the queue…"
              : `Writing ${row.title}…`}
          </div>
        ) : body ? (
          <Markdown source={body} />
        ) : (
          <EmptyState
            icon={Sparkles}
            title="Not generated yet"
            hint={
              row.guidance ??
              "Write this document from the repository's commits, pull requests and summary."
            }
            action={
              <Button size="sm" onClick={() => onGenerate(row)}>
                <Sparkles className="size-4" /> Write it
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
