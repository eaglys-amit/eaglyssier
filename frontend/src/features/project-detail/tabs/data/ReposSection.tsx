import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ExternalLink,
  FolderGit2,
  GitPullRequest,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Spinner } from "@/components/shared/Spinner";
import { jobBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionPanel } from "@/features/project-detail/tabs/data/SectionPanel";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime, shortSha } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type {
  AnalysisScope,
  Commit,
  CommitAnalysis,
  PullRequest,
  Repo,
  RepoSummary,
  RepoSync,
} from "@/types/api";

const isRunning = (s: string | undefined | null) => s === "running";

type RepoView = "summary" | "pulls" | "commits";

/** No active member = no filter; otherwise only rows authored by that member. */
function byMember<T extends { author_member_id: number | null }>(
  rows: T[],
  memberId: number | null,
): T[] {
  if (memberId == null) return rows;
  return rows.filter((r) => r.author_member_id === memberId);
}

function Diff({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="font-mono text-xs tabular-nums whitespace-nowrap">
      <span className="text-success">+{additions}</span>{" "}
      <span className="text-destructive">−{deletions}</span>
    </span>
  );
}

/* ------------------------------------------------------------- repo summary */

function RepoSummaryPanel({ repo }: { repo: Repo }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.repoSummary(repo.id),
    queryFn: () => api.get<RepoSummary>(`/repos/${repo.id}/summary`),
    refetchInterval: (q) => (isRunning(q.state.data?.status) ? 2000 : false),
  });
  const generate = useMutation({
    mutationFn: () => api.post<RepoSummary>(`/repos/${repo.id}/summarize`),
    onSuccess: (s) => qc.setQueryData(qk.repoSummary(repo.id), s),
    onError: (err: ApiError) => toast.error(err.detail || "Could not start summary"),
  });

  const status = data?.status ?? repo.summary_status;
  const summary = data?.summary;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {jobBadge(status, { none: "Not summarized" })}
          {data?.summarized_at ? (
            <span className="text-xs text-muted-foreground">
              {formatDateTime(data.summarized_at)}
              {data.model ? ` · ${data.model}` : ""}
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={isRunning(status) || generate.isPending}
          onClick={() => generate.mutate()}
        >
          <Sparkles className="size-4" />
          {isRunning(status) ? "Summarizing…" : summary ? "Regenerate" : "Generate summary"}
        </Button>
      </div>

      {status === "failed" && data?.error ? <ErrorAlert message={data.error} /> : null}
      {isRunning(status) ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Analyzing repository activity…
        </div>
      ) : summary ? (
        <div className="space-y-3 text-sm">
          {summary.overview ? <p>{summary.overview}</p> : null}
          {summary.tech_areas?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {summary.tech_areas.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
          {summary.activity ? <p className="text-muted-foreground">{summary.activity}</p> : null}
          {summary.highlights?.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {summary.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          ) : null}
          {summary.contributors?.length ? (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Contributors
              </div>
              <ul className="space-y-1">
                {summary.contributors.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground"> — {c.focus}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : status !== "failed" ? (
        <p className="text-sm text-muted-foreground">
          Generate an LLM overview of this repository's activity and contributors.
        </p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- commits */

function CommitAnalysisPanel({ commit, repoId }: { commit: Commit; repoId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.commitAnalysis(commit.id),
    queryFn: () => api.get<CommitAnalysis>(`/commits/${commit.id}/analysis`),
    refetchInterval: (q) => (isRunning(q.state.data?.status) ? 2000 : false),
  });
  const analyze = useMutation({
    mutationFn: () => api.post<CommitAnalysis>(`/commits/${commit.id}/analyze`),
    onSuccess: (a) => qc.setQueryData(qk.commitAnalysis(commit.id), a),
    onError: (err: ApiError) => toast.error(err.detail || "Could not start analysis"),
  });

  // Refresh the commits list badge when this analysis settles.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && data && !isRunning(data.status)) {
      qc.invalidateQueries({ queryKey: qk.commits(repoId) });
    }
    wasRunning.current = isRunning(data?.status);
  }, [data, qc, repoId]);

  const status = data?.status ?? commit.analysis_status;
  const analysis = data?.analysis;

  return (
    <div className="space-y-2 bg-muted/40 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {jobBadge(status, { none: "Not analyzed" })}
          {data?.analyzed_at ? (
            <span className="text-xs text-muted-foreground">
              {formatDateTime(data.analyzed_at)}
              {data.model ? ` · ${data.model}` : ""}
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={isRunning(status) || analyze.isPending}
          onClick={() => analyze.mutate()}
        >
          <Sparkles className="size-3.5" />
          {isRunning(status) ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze"}
        </Button>
      </div>
      {status === "failed" && data?.error ? <ErrorAlert message={data.error} /> : null}
      {analysis ? (
        <div className="space-y-2 text-sm">
          {analysis.categories?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {analysis.categories.map((c) => (
                <Badge key={c} variant="secondary">
                  {c}
                </Badge>
              ))}
            </div>
          ) : null}
          {analysis.summary ? <p>{analysis.summary}</p> : null}
          {analysis.changes?.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {analysis.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
          {analysis.files?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  {analysis.files.map((f, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1 pr-3 font-mono whitespace-nowrap">{f.path}</td>
                      <td className="py-1 text-muted-foreground">{f.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CommitList({ repoId, memberId }: { repoId: number; memberId: number | null }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showMerges, setShowMerges] = useState(false);
  const qc = useQueryClient();
  const { data: allCommits, isPending } = useQuery({
    queryKey: qk.commits(repoId),
    queryFn: () => api.get<Commit[]>(`/repos/${repoId}/commits`),
    refetchInterval: (q) =>
      q.state.data?.some((c) => isRunning(c.analysis_status)) ? 2000 : false,
  });

  const analyzeAll = useMutation({
    mutationFn: () => api.post<{ queued: number }>(`/repos/${repoId}/analyze-all`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.commits(repoId) });
      toast.success(r.queued ? `Queued ${r.queued} commits for analysis` : "Nothing to analyze");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not queue analysis"),
  });

  if (isPending) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Spinner /> Loading commits…
      </div>
    );
  }
  if (!allCommits?.length) {
    return <p className="p-4 text-sm text-muted-foreground">No commits synced.</p>;
  }
  const forMember = byMember(allCommits, memberId);
  if (!forMember.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No commits by the selected member.
      </p>
    );
  }
  const mergeCount = forMember.filter((c) => c.is_merge).length;
  const commits = showMerges ? forMember : forMember.filter((c) => !c.is_merge);
  const anyRunning = commits.some((c) => isRunning(c.analysis_status));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <span className="text-xs text-muted-foreground">
          {memberId != null
            ? `${commits.length} of ${allCommits.length} commits (member filter)`
            : `${commits.length} commits`}
          {!showMerges && mergeCount ? ` · ${mergeCount} merges hidden` : ""}
        </span>
        <div className="flex items-center gap-3">
          {mergeCount ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={showMerges}
                onCheckedChange={(v) => setShowMerges(v === true)}
              />
              Show merges ({mergeCount})
            </label>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={anyRunning || analyzeAll.isPending}
            onClick={() => analyzeAll.mutate()}
          >
            <Sparkles className="size-4" /> Analyze all
          </Button>
        </div>
      </div>
      {!commits.length ? (
        <p className="p-4 text-sm text-muted-foreground">
          Only merge commits here — enable “Show merges” to see them.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">SHA</TableHead>
            <TableHead>Message</TableHead>
            <TableHead className="w-40">Author</TableHead>
            <TableHead className="w-28">Date</TableHead>
            <TableHead className="w-28 text-right">Diff</TableHead>
            <TableHead className="w-32">Analysis</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {commits.map((c) => {
            const open = expanded.has(c.id);
            return [
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() =>
                  setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
              >
                <TableCell className="font-mono text-xs">{shortSha(c.sha)}</TableCell>
                <TableCell className="max-w-md">
                  <span className="flex items-center gap-1.5">
                    {c.is_merge ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        merge
                      </Badge>
                    ) : null}
                    <span className="truncate">{c.message?.split("\n")[0] || "—"}</span>
                  </span>
                </TableCell>
                <TableCell className="truncate text-muted-foreground">
                  {c.author_name || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(c.authored_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Diff additions={c.additions} deletions={c.deletions} />
                </TableCell>
                <TableCell>{jobBadge(c.analysis_status, { none: "—" })}</TableCell>
              </TableRow>,
              open ? (
                <TableRow key={`${c.id}-detail`} className="hover:bg-transparent">
                  <TableCell colSpan={6} className="p-0">
                    <CommitAnalysisPanel commit={c} repoId={repoId} />
                  </TableCell>
                </TableRow>
              ) : null,
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------ pull requests */

function PrTable({ repoId, memberId }: { repoId: number; memberId: number | null }) {
  const { data: allPrs, isPending } = useQuery({
    queryKey: qk.pulls(repoId),
    queryFn: () => api.get<PullRequest[]>(`/repos/${repoId}/pulls`),
  });

  if (isPending) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Spinner /> Loading pull requests…
      </div>
    );
  }
  if (!allPrs?.length) {
    return <p className="p-4 text-sm text-muted-foreground">No pull requests synced.</p>;
  }
  const prs = byMember(allPrs, memberId);
  if (!prs.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No pull requests by the selected member.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">#</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-24">State</TableHead>
          <TableHead className="w-40">Author</TableHead>
          <TableHead className="w-28 text-right">Diff</TableHead>
          <TableHead className="w-24 text-right">Reviews</TableHead>
          <TableHead className="w-28">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {prs.map((pr) => (
          <TableRow key={pr.id}>
            <TableCell className="font-mono text-xs">#{pr.external_id}</TableCell>
            <TableCell className="max-w-md truncate">{pr.title || "—"}</TableCell>
            <TableCell>
              <Badge
                variant={pr.state === "merged" ? "default" : "secondary"}
                className={pr.state === "merged" ? "bg-primary/85" : undefined}
              >
                {pr.state ?? "—"}
              </Badge>
            </TableCell>
            <TableCell className="truncate text-muted-foreground">
              {pr.author_name || "—"}
            </TableCell>
            <TableCell className="text-right">
              <Diff additions={pr.additions} deletions={pr.deletions} />
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {pr.reviews.length}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDate(pr.created_at_src)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* -------------------------------------------------------------------- repos */

function RepoCard({
  projectId,
  repo,
  view,
  activeMemberId,
  scope,
  onToggleRepo,
}: {
  projectId: number;
  repo: Repo;
  view: RepoView;
  activeMemberId: number | null;
  scope: AnalysisScope;
  onToggleRepo: (id: number) => void;
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
        {activeMemberId != null ? (
          <Checkbox
            checked={scope.repo_ids.includes(repo.id)}
            onCheckedChange={() => onToggleRepo(repo.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Include repository ${repo.name} in this member's analysis scope`}
          />
        ) : null}
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
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={syncing}
          onClick={() => trigger.mutate()}
        >
          <RefreshCw className={syncing ? "size-3.5 animate-spin" : "size-3.5"} />
          <span className="sr-only">Sync repository</span>
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
          {view === "summary" ? <RepoSummaryPanel repo={repo} /> : null}
          {view === "pulls" ? <PrTable repoId={repo.id} memberId={activeMemberId} /> : null}
          {view === "commits" ? <CommitList repoId={repo.id} memberId={activeMemberId} /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ReposSection({
  projectId,
  provider,
  activeMemberId,
  scope,
  onToggleRepo,
  open,
  onOpenChange,
}: {
  projectId: number;
  provider?: string;
  activeMemberId: number | null;
  scope: AnalysisScope;
  onToggleRepo: (id: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // One view toggle shared by every repo card in this section.
  const [view, setView] = useState<RepoView>("summary");
  const { data } = useQuery({
    queryKey: qk.repos(projectId),
    queryFn: () => api.get<Repo[]>(`/projects/${projectId}/repos`),
  });
  const repos = provider ? data?.filter((r) => r.provider === provider) : data;
  const label = provider === "github" ? "GitHub" : provider === "gitlab" ? "GitLab" : null;

  return (
    <SectionPanel
      title={label ? `${label} repositories` : "Repositories"}
      count={repos?.length}
      open={open}
      onOpenChange={onOpenChange}
      actions={
        repos?.length ? (
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
      {!repos?.length ? (
        <EmptyState
          icon={FolderGit2}
          title={label ? `No ${label} repositories synced` : "No repositories synced"}
          hint={
            label
              ? `Run a ${label} sync to pull repositories, commits, and pull requests.`
              : "Connect GitHub or GitLab and run a sync to pull repositories, commits, and pull requests."
          }
        />
      ) : (
        <div className="space-y-2">
          {repos.map((r) => (
            <RepoCard
              key={r.id}
              projectId={projectId}
              repo={r}
              view={view}
              activeMemberId={activeMemberId}
              scope={scope}
              onToggleRepo={onToggleRepo}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  );
}
