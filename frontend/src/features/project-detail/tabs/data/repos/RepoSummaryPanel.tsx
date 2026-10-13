import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Spinner } from "@/components/shared/Spinner";
import { jobBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Repo, RepoSummary } from "@/types/api";

import { isRunning } from "./repo-utils";

export function RepoSummaryPanel({ projectId, repo }: { projectId: number; repo: Repo }) {
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
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

      {/* A second way in to the documentation set. The row's "Docs" button is
          easy to miss among nine other controls, and this is where someone
          reading about the repo would want to go next. */}
      <div className="border-t pt-2">
        <Link
          to={`/projects/${projectId}/repo-docs?repo=${repo.id}`}
          className="text-primary text-xs underline-offset-4 hover:underline"
        >
          Write the full documentation set →
        </Link>
      </div>
    </div>
  );
}
