import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { syncRunBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Integration, ProjectIntegrations, SyncStatus } from "@/types/api";

export const SOURCE_LABELS: Record<string, string> = {
  jira: "Jira",
  github: "GitHub",
  gitlab: "GitLab",
};

function SyncCard({
  projectId,
  integration,
  selected,
  onSelect,
}: {
  projectId: number;
  integration: Integration;
  selected: boolean;
  onSelect: () => void;
}) {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: qk.syncStatus(integration.id),
    queryFn: () => api.get<SyncStatus>(`/integrations/${integration.id}/sync-status`),
    refetchInterval: (query) => (query.state.data?.syncing ? 2000 : false),
  });

  // When a sync finishes, refresh everything it may have produced.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && status && !status.syncing) {
      qc.invalidateQueries({ queryKey: qk.project(projectId) });
      qc.invalidateQueries({ queryKey: qk.syncRuns(projectId) });
    }
    wasSyncing.current = status?.syncing ?? false;
  }, [status, projectId, qc]);

  const trigger = useMutation({
    mutationFn: () => api.post<SyncStatus>(`/integrations/${integration.id}/sync`),
    onSuccess: (s) => qc.setQueryData(qk.syncStatus(integration.id), s),
    onError: (err: ApiError) => toast.error(err.detail || "Could not start sync"),
  });

  const syncing = status?.syncing || trigger.isPending;
  const run = status?.run ?? null;
  const label = SOURCE_LABELS[integration.type] ?? integration.type;
  const info = run?.error
    ? run.error
    : run?.stats && Object.keys(run.stats).length
      ? Object.entries(run.stats)
          .map(([k, v]) => `${v} ${k}`)
          .join(" · ")
      : run?.finished_at
        ? `Last run ${formatDateTime(run.finished_at)}`
        : "Never synced";

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "cursor-pointer py-0 transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-muted-foreground/40",
      )}
    >
      <CardContent className="flex items-center gap-2 px-3 py-2">
        <PlatformIcon platform={integration.type} size={16} />
        <span className={cn("text-sm font-medium", selected && "text-primary")}>{label}</span>
        {syncing ? syncRunBadge("running") : run ? syncRunBadge(run.status) : null}
        <span
          className="ml-1 max-w-56 truncate text-xs text-muted-foreground"
          title={info}
        >
          {info}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="ml-1 size-7"
          disabled={syncing || !integration.enabled}
          title={syncing ? "Syncing…" : "Sync"}
          onClick={(e) => {
            e.stopPropagation();
            trigger.mutate();
          }}
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          <span className="sr-only">{syncing ? "Syncing…" : "Sync"}</span>
        </Button>
      </CardContent>
    </Card>
  );
}

export function SyncCards({
  projectId,
  selected,
  onSelect,
}: {
  projectId: number;
  selected: string | null;
  onSelect: (type: string) => void;
}) {
  const { data } = useQuery({
    queryKey: qk.integrations(projectId),
    queryFn: () => api.get<ProjectIntegrations>(`/projects/${projectId}/integrations`),
  });
  const configured = data?.items.filter((i) => i.type in SOURCE_LABELS);

  if (!configured?.length) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No integrations connected yet.{" "}
          <Link className="text-primary hover:underline" to={`/projects/${projectId}/integrations`}>
            Configure integrations →
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {configured.map((i) => (
        <SyncCard
          key={i.id}
          projectId={projectId}
          integration={i}
          selected={selected === i.type}
          onSelect={() => onSelect(i.type)}
        />
      ))}
    </div>
  );
}
