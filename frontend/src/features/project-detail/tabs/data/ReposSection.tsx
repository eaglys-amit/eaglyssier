import { useQuery } from "@tanstack/react-query";
import { FolderGit2, GitPullRequest } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  IntegrationSyncBar,
  IntegrationSyncStatus,
} from "@/features/project-detail/tabs/data/IntegrationSync";
import { SectionPanel } from "@/features/project-detail/tabs/data/SectionPanel";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ProjectIntegrations, Repo } from "@/types/api";

import { PendingRepoRow, RepoCard, type RepoEntry } from "./repos/RepoCard";
import { GIT_TYPES, type RepoView } from "./repos/repo-utils";

export function ReposSection({
  projectId,
  personId,
}: {
  projectId: number;
  personId: number | null;
}) {
  // One view toggle shared by every repo card in this section.
  const [view, setView] = useState<RepoView>("summary");
  const { data: repos } = useQuery({
    queryKey: qk.repos(projectId),
    queryFn: () => api.get<Repo[]>(`/projects/${projectId}/repos`),
  });
  const { data: integrations } = useQuery({
    queryKey: qk.integrations(projectId),
    queryFn: () => api.get<ProjectIntegrations>(`/projects/${projectId}/integrations`),
  });

  const gitIntegrations = (integrations?.items ?? []).filter((i) =>
    GIT_TYPES.includes(i.type),
  );

  // The picked repos are known from the integration config, so list them all —
  // one that has never been pulled still gets a row and its own sync button
  // instead of only appearing after a full integration sync.
  const entries: RepoEntry[] = [];
  const claimed = new Set<number>();
  for (const integ of gitIntegrations) {
    const cfg = integ.config as Record<string, unknown>;
    for (const name of ((cfg.repos ?? cfg.projects ?? []) as string[]) ?? []) {
      const repo = repos?.find((r) => r.name === name && r.provider === integ.type) ?? null;
      if (repo) claimed.add(repo.id);
      entries.push({ fullName: name, provider: integ.type, repo });
    }
  }
  // Synced repos the config no longer lists (deselected, renamed) still belong
  // here — the next full sync is what prunes them.
  for (const r of repos ?? []) {
    if (!claimed.has(r.id)) entries.push({ fullName: r.name, provider: r.provider, repo: r });
  }
  entries.sort((a, b) => a.fullName.localeCompare(b.fullName));
  const pendingCount = entries.filter((e) => !e.repo).length;

  return (
    <SectionPanel
      title="Repositories"
      count={entries.length || undefined}
      sync={<IntegrationSyncBar projectId={projectId} types={GIT_TYPES} />}
      subtitle={<IntegrationSyncStatus projectId={projectId} types={GIT_TYPES} />}
      actions={
        entries.length ? (
          <Tabs value={view} onValueChange={(v) => setView(v as RepoView)}>
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="pulls">
                <GitPullRequest className="size-3.5" /> PRs
              </TabsTrigger>
              <TabsTrigger value="commits">Commits</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null
      }
    >
      {pendingCount ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {pendingCount} of {entries.length} never synced — sync a provider above, or a single
          repository from its row.
        </p>
      ) : null}
      {!entries.length ? (
        <EmptyState
          icon={FolderGit2}
          title="No repositories selected"
          hint={
            gitIntegrations.length
              ? "Pick repositories under Integrations, then sync them here."
              : "Connect GitHub or GitLab and pick repositories under Integrations."
          }
        />
      ) : (
        <div className="space-y-2">
          {entries.map((e) =>
            e.repo ? (
              <RepoCard
                key={e.repo.id}
                projectId={projectId}
                repo={e.repo}
                view={view}
                personId={personId}
              />
            ) : (
              <PendingRepoRow
                key={`${e.provider}:${e.fullName}`}
                projectId={projectId}
                fullName={e.fullName}
                provider={e.provider}
              />
            ),
          )}
        </div>
      )}
    </SectionPanel>
  );
}
