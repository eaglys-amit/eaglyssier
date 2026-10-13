import { GitBranch, RefreshCw } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
 * plan.md, tasks.md). Turning one on reads it now and on every repo sync after.
 */
export function SpecSources({ projectId }: { projectId: number }) {
  const { data: sources } = useSpecSources(projectId);
  if (!sources?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Specs in repositories</CardTitle>
        <CardDescription>
          Reads spec-kit feature folders (<span className="font-mono">specs/001-feature/spec.md</span>,
          plus <span className="font-mono">plan.md</span> and <span className="font-mono">tasks.md</span>)
          from the default branch. Lines in tasks.md are matched to existing tasks; none are created.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y border-t">
          {sources.map((s) => (
            <SourceRow key={s.repo_id} projectId={projectId} source={s} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
