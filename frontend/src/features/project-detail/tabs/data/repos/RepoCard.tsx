import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookText, ChevronDown, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { jobBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { Repo, RepoSync } from "@/types/api";

import { CommitList } from "./CommitList";
import { PrTable } from "./PrTable";
import { isRunning, type RepoView } from "./repo-utils";
import { RepoSummaryPanel } from "./RepoSummaryPanel";

/** A configured repo paired with its synced row, if it has one yet. */
export type RepoEntry = { fullName: string; provider: string; repo: Repo | null };

/** A repo picked under Integrations that has never been pulled. */
export function PendingRepoRow({
  projectId,
  fullName,
  provider,
}: {
  projectId: number;
  fullName: string;
  provider: string;
}) {
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () =>
      api.post<RepoSync>(`/projects/${projectId}/repos/sync`, {
        provider,
        full_name: fullName,
      }),
    onSuccess: () => {
      // The repo row now exists; the card that replaces this one polls it.
      qc.invalidateQueries({ queryKey: qk.repos(projectId) });
      toast.success(`Syncing ${fullName}…`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start sync"),
  });

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed bg-card/40 px-4 py-2.5">
      <span className="size-4 shrink-0" />
      <PlatformIcon platform={provider} size={14} />
      <span className="truncate text-sm font-medium">{fullName}</span>
      <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Never synced</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        disabled={sync.isPending}
        onClick={() => sync.mutate()}
      >
        <RefreshCw className={sync.isPending ? "size-3.5 animate-spin" : "size-3.5"} />
        {sync.isPending ? "Starting…" : "Sync"}
        <span className="sr-only">{fullName}</span>
      </Button>
    </div>
  );
}

export function RepoCard({
  projectId,
  repo,
  view,
  personId,
}: {
  projectId: number;
  repo: Repo;
  view: RepoView;
  personId: number | null;
}) {
  const qc = useQueryClient();
  const { data: sync } = useQuery({
    queryKey: qk.repoSync(repo.id),
    queryFn: () => api.get<RepoSync>(`/repos/${repo.id}/sync-status`),
    refetchInterval: (q) => (isRunning(q.state.data?.sync_status) ? 2000 : false),
    initialData: {
      id: repo.id,
      sync_status: repo.sync_status,
      sync_error: repo.sync_error,
      synced_at: repo.synced_at,
    },
  });
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && sync && !isRunning(sync.sync_status)) {
      qc.invalidateQueries({ queryKey: qk.repos(projectId) });
      qc.invalidateQueries({ queryKey: qk.commits(repo.id) });
      qc.invalidateQueries({ queryKey: qk.pulls(repo.id) });
    }
    wasRunning.current = isRunning(sync?.sync_status);
  }, [sync, projectId, repo.id, qc]);

  const trigger = useMutation({
    mutationFn: () => api.post<RepoSync>(`/repos/${repo.id}/sync`),
    onSuccess: (s) => qc.setQueryData(qk.repoSync(repo.id), s),
    onError: (err: ApiError) => toast.error(err.detail || "Could not start repo sync"),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/repos/${repo.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.repos(projectId) });
      toast.success("Repository removed");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not remove repository"),
  });

  const syncing = isRunning(sync?.sync_status) || trigger.isPending;

  return (
    <Collapsible className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
          <PlatformIcon platform={repo.provider} size={14} />
          <span className="truncate text-sm font-medium">{repo.name}</span>
          {syncing ? jobBadge("running", { running: "Syncing" }) : null}
          {sync?.sync_status === "failed" ? jobBadge("failed") : null}
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
            {repo.commit_count} commits · {repo.pr_count} PRs
          </span>
        </CollapsibleTrigger>
        {repo.url ? (
          <Button asChild variant="ghost" size="icon" className="size-7">
            <a href={repo.url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              <span className="sr-only">Open repository</span>
            </a>
          </Button>
        ) : null}
        {/* Sits with the repository's own actions rather than inside the
            collapsible: the documentation set is a property of the repo, not of
            whichever panel happens to be showing. Labelled "Docs" because this
            row already carries a chevron, an icon, a name, badges, a
            counter, an external link, a labelled Sync and a trash icon — the
            sr-only text supplies the repo name, as Sync's does below. */}
        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
          <Link to={`/projects/${projectId}/repo-docs?repo=${repo.id}`}>
            <BookText className="size-3.5" />
            Docs
            <span className="sr-only">for {repo.name}</span>
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={syncing}
          onClick={() => trigger.mutate()}
        >
          <RefreshCw className={syncing ? "size-3.5 animate-spin" : "size-3.5"} />
          {syncing ? "Syncing…" : "Sync"}
          <span className="sr-only">{repo.name}</span>
        </Button>
        <ConfirmDialog
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              <span className="sr-only">Remove repository</span>
            </Button>
          }
          title={`Remove ${repo.name}?`}
          description="Removes the repo and its synced commits/PRs. A re-sync re-adds it."
          onConfirm={() => remove.mutate()}
        />
      </div>
      {sync?.sync_status === "failed" && sync.sync_error ? (
        <div className="px-4 pb-2">
          <ErrorAlert message={sync.sync_error} />
        </div>
      ) : null}
      <CollapsibleContent>
        {/* Which panel shows is driven by the section-level toggle (all repos share it). */}
        <div className="border-t">
          {view === "summary" ? (
            <RepoSummaryPanel projectId={projectId} repo={repo} />
          ) : null}
          {view === "pulls" ? <PrTable repoId={repo.id} memberId={personId} /> : null}
          {view === "commits" ? <CommitList repoId={repo.id} memberId={personId} /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
