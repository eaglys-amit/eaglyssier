import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Spinner } from "@/components/shared/Spinner";
import { jobBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime, shortSha } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Commit, CommitAnalysis } from "@/types/api";

import { byMember, Diff, isRunning } from "./repo-utils";

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

export function CommitList({ repoId, memberId }: { repoId: number; memberId: number | null }) {
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
        No commits by the selected person.
      </p>
    );
  }
  const mergeCount = forMember.filter((c) => c.is_merge).length;
  const commits = showMerges ? forMember : forMember.filter((c) => !c.is_merge);
  const anyRunning = commits.some((c) => isRunning(c.analysis_status));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
        <span className="text-xs text-muted-foreground">
          {memberId != null
            ? `${commits.length} of ${allCommits.length} commits (person filter)`
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
