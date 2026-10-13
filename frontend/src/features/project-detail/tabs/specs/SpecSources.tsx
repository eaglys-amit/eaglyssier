import { AlertTriangle, GitBranch, RefreshCw } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import type { SpecSource } from "@/types/api";

import { useSpecMutations, useSpecSources } from "./useSpecs";

function SourceRow({ projectId, source }: { projectId: number; source: SpecSource }) {
  const canSync = useAccess(projectId).can("ops");
  const m = useSpecMutations(projectId);
  const [path, setPath] = useState(source.spec_path);
  const running = source.spec_sync_status === "running";

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Switch
        checked={source.spec_sync_enabled}
        disabled={!canSync || m.setSource.isPending}
        onCheckedChange={(enabled) => m.setSource.mutate({ repoId: source.repo_id, enabled, specPath: path })}
        aria-label={`Read specs from ${source.name}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <GitBranch className="size-3.5 text-muted-foreground" />
          {source.name}
          {source.default_branch ? (
            <span className="font-mono text-xs font-normal text-muted-foreground">@{source.default_branch}</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {running ? (
            <StatusBadge variant="running" label="Syncing specs" spinning />
          ) : source.spec_sync_status === "failed" ? (
            <span className="text-destructive">Sync failed: {source.spec_sync_error}</span>
          ) : source.spec_sync_enabled && source.spec_synced_at ? (
            <>
              {source.spec_count} spec{source.spec_count === 1 ? "" : "s"} · synced{" "}
              {formatDateTime(source.spec_synced_at)}
              {source.spec_sync_error ? <span className="text-warning"> · {source.spec_sync_error}</span> : null}
            </>
          ) : source.spec_count ? (
            `${source.spec_count} spec(s) kept from earlier syncs · sync off`
          ) : (
            "Not reading specs"
          )}
        </div>
      </div>
      <Input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        disabled={!canSync || source.spec_sync_enabled}
        className="h-8 w-36 font-mono text-xs"
        title="Folder holding one sub-folder per feature, each with a spec.md"
        aria-label="Spec folder"
      />
      {canSync && source.spec_sync_enabled ? (
        <Button size="sm" variant="outline" disabled={running || m.syncSource.isPending}
                onClick={() => m.syncSource.mutate(source.repo_id)}>
          <RefreshCw className="size-3.5" /> Sync
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Repositories as spec sources (spec-kit layout: <folder>/<feature>/spec.md,
 * plan.md, tasks.md). Setup, not something to act on daily — so it lives in a
 * dialog opened from the Specs title bar, next to "Track a spec": the two ways
 * specs come in. Turning one on reads it now and on every repo sync after.
 */
export function SpecSourcesDialog({ projectId, open, onOpenChange }: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: sources } = useSpecSources(projectId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Spec sources: repositories</DialogTitle>
          <DialogDescription>
            Reads spec-kit feature folders (<span className="font-mono">specs/001-feature/spec.md</span>,
            plus <span className="font-mono">plan.md</span> and <span className="font-mono">tasks.md</span>)
            from each repository's default branch. Lines in tasks.md are matched to existing tasks;
            none are created. To track an uploaded document instead, use "Track a spec".
          </DialogDescription>
        </DialogHeader>
        {sources?.length ? (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border">
            {sources.map((s) => (
              <SourceRow key={s.repo_id} projectId={projectId} source={s} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No repositories synced yet — connect GitHub or GitLab on the Integrations page and sync
            a repository from the Data tab.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Repositories with spec sync on whose last sync failed. */
function failing(sources: SpecSource[] | undefined): SpecSource[] {
  return (sources ?? []).filter((s) => s.spec_sync_enabled && s.spec_sync_status === "failed");
}

/** Failed spec syncs, as one line each — shown on the Overview so they aren't missed. */
export function SpecSyncWarnings({ projectId, onOpenSources }: {
  projectId: number;
  onOpenSources: () => void;
}) {
  const { data: sources } = useSpecSources(projectId);
  const failed = failing(sources);
  if (!failed.length) return null;
  return (
    <div className="space-y-1.5">
      {failed.map((s) => (
        <div key={s.repo_id}
             className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            Spec sync failed for <span className="font-medium">{s.name}</span>
            {s.spec_sync_error ? <span className="text-muted-foreground"> — {s.spec_sync_error}</span> : null}
          </span>
          <Button size="xs" variant="outline" onClick={onOpenSources}>Open Sources</Button>
        </div>
      ))}
    </div>
  );
}

/** How many sources are failing — the title-bar button shows a dot for it. */
export function useFailingSpecSources(projectId: number): number {
  const { data: sources } = useSpecSources(projectId);
  return failing(sources).length;
}
