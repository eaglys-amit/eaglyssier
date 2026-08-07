import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { StatusBadge, syncRunBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Integration, ProjectIntegrations, SyncRun, SyncStatus } from "@/types/api";

const SOURCE_LABELS: Record<string, string> = {
  jira: "Jira",
  github: "GitHub",
  gitlab: "GitLab",
};

const labelOf = (type: string) => SOURCE_LABELS[type] ?? type;

/** Shared key, so the button and the status line poll once between them. */
function useSyncStatus(integrationId: number) {
  return useQuery({
    queryKey: qk.syncStatus(integrationId),
    queryFn: () => api.get<SyncStatus>(`/integrations/${integrationId}/sync-status`),
    refetchInterval: (query) => (query.state.data?.syncing ? 2000 : false),
  });
}

/** What the last run produced, or why it didn't. */
function runInfo(run: SyncRun | null): string {
  if (!run) return "Never synced";
  if (run.error) return run.error;
  if (run.stats && Object.keys(run.stats).length) {
    return Object.entries(run.stats)
      .map(([k, v]) => `${v} ${k}`)
      .join(" · ");
  }
  return run.finished_at ? `Last run ${formatDateTime(run.finished_at)}` : "Never synced";
}

function useIntegrationsOfType(projectId: number, types: string[]) {
  const { data } = useQuery({
    queryKey: qk.integrations(projectId),
    queryFn: () => api.get<ProjectIntegrations>(`/projects/${projectId}/integrations`),
  });
  return data ? data.items.filter((i) => types.includes(i.type)) : null;
}

function SyncButton({ projectId, integration }: { projectId: number; integration: Integration }) {
  const qc = useQueryClient();
  const { data: status } = useSyncStatus(integration.id);

  // When a sync finishes, refresh everything it may have produced.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && status && !status.syncing) {
      qc.invalidateQueries({ queryKey: qk.project(projectId) });
      qc.invalidateQueries({ queryKey: qk.syncRuns(projectId) });
      qc.invalidateQueries({ queryKey: qk.repos(projectId) });
      qc.invalidateQueries({ queryKey: qk.sprints(projectId) });
      qc.invalidateQueries({ queryKey: qk.tasks(projectId) });
    }
    wasSyncing.current = status?.syncing ?? false;
  }, [status, projectId, qc]);

  const trigger = useMutation({
    mutationFn: () => api.post<SyncStatus>(`/integrations/${integration.id}/sync`),
    onSuccess: (s) => qc.setQueryData(qk.syncStatus(integration.id), s),
    onError: (err: ApiError) => toast.error(err.detail || "Could not start sync"),
  });

  const syncing = status?.syncing || trigger.isPending;
  const label = labelOf(integration.type);

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 shrink-0 px-2"
      disabled={syncing || !integration.enabled}
      title={syncing ? `Syncing ${label}…` : `Sync ${label}`}
      onClick={() => trigger.mutate()}
    >
      <PlatformIcon platform={integration.type} size={14} />
      <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
      {syncing ? "Syncing…" : "Sync"}
      <span className="sr-only">{label}</span>
    </Button>
  );
}

function SyncStatusLine({ integration }: { integration: Integration }) {
  const { data: status } = useSyncStatus(integration.id);
  const run = status?.run ?? null;
  const info = runInfo(run);
  const label = labelOf(integration.type);

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      {status?.syncing ? (
        syncRunBadge("running")
      ) : run ? (
        syncRunBadge(run.status)
      ) : (
        <StatusBadge variant="neutral" label="Never synced" />
      )}
      {run ? (
        <span className="truncate" title={info}>
          {info}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Sync triggers for the integrations that feed one panel — Jira for sprints,
 * GitHub/GitLab for repositories. Sits in that panel's header rather than in a
 * source row of its own, since both panels are always shown.
 */
export function IntegrationSyncBar({ projectId, types }: { projectId: number; types: string[] }) {
  const configured = useIntegrationsOfType(projectId, types);
  if (!configured) return null;

  if (!configured.length) {
    return (
      <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground">
        <Link
          to={`/projects/${projectId}/integrations`}
          title={`${types.map(labelOf).join(" or ")} is not connected`}
        >
          <Plug className="size-3.5" /> Connect
        </Link>
      </Button>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1">
      {configured.map((i) => (
        <SyncButton key={i.id} projectId={projectId} integration={i} />
      ))}
    </div>
  );
}

/** The same integrations' last-run state, for the panel header's subtitle line. */
export function IntegrationSyncStatus({
  projectId,
  types,
}: {
  projectId: number;
  types: string[];
}) {
  const configured = useIntegrationsOfType(projectId, types);
  if (!configured?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {configured.map((i) => (
        <SyncStatusLine key={i.id} integration={i} />
      ))}
    </div>
  );
}
