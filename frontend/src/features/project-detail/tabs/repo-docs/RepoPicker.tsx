import { useQuery } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { Spinner } from "@/components/shared/Spinner";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { Repo, RepoDocSummary } from "@/types/api";

/**
 * Which repository's documents to work on, when the URL doesn't say.
 *
 * Reached from a bare /repo-docs (or the legacy #repo-docs hash), so the page
 * always lands somewhere useful rather than on an empty pane.
 *
 * Never-synced repositories are shown disabled rather than hidden: the set is
 * written from synced commits, PRs and the repo summary, so a repo with nothing
 * pulled has nothing to write from — and saying so is more useful than leaving
 * the user wondering why it isn't listed.
 */
export function RepoPicker({
  projectId,
  onPick,
}: {
  projectId: number;
  onPick: (repoId: number) => void;
}) {
  const repos = useQuery({
    queryKey: qk.repos(projectId),
    queryFn: () => api.get<Repo[]>(`/projects/${projectId}/repos`),
  });
  const summaries = useQuery({
    queryKey: qk.repoDocsOverview(projectId),
    queryFn: () => api.get<RepoDocSummary[]>(`/projects/${projectId}/repo-docs`),
  });

  if (repos.isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> Loading repositories…
      </div>
    );
  }

  const rows = repos.data ?? [];
  if (!rows.length) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No repositories synced yet"
        hint="Connect GitHub or GitLab on the Integrations page, then sync a repository from the Data tab."
      />
    );
  }

  const byRepo = new Map((summaries.data ?? []).map((s) => [s.repo_id, s]));

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((repo) => {
        const stats = byRepo.get(repo.id);
        const synced = repo.commit_count > 0 || repo.synced_at != null;
        const total = stats?.total ?? 0;
        const ready = stats?.ready ?? 0;

        return (
          <button
            key={repo.id}
            type="button"
            disabled={!synced}
            onClick={() => onPick(repo.id)}
            className={cn(
              "bg-card flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
              synced ? "hover:border-primary/40 hover:bg-accent/40" : "opacity-60",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <PlatformIcon platform={repo.provider} size={14} />
              <span className="truncate text-sm font-medium">{repo.name}</span>
            </div>

            {!synced ? (
              <p className="text-muted-foreground text-xs">
                Sync it on the Data tab first — the documents are written from
                its commits and pull requests.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground text-xs">
                  {total
                    ? `${total} document${total === 1 ? "" : "s"} · ${ready} written`
                    : "Not set up yet — open it to create the standard set."}
                  {stats?.failed ? ` · ${stats.failed} failed` : ""}
                </p>
                {total ? (
                  <div className="bg-muted h-1 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-[width]"
                      style={{ width: `${Math.round((ready / total) * 100)}%` }}
                    />
                  </div>
                ) : null}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
