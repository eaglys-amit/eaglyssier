import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, shortSha } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { CommitDetail } from "@/types/api";

/** Slide-over commit detail bound to the ?commit= param, with manual attach. */
export function CommitSheet() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const commitId = Number(params.get("commit"));
  const open = Number.isFinite(commitId) && commitId > 0;

  const { data: commit, isPending, error } = useQuery({
    queryKey: qk.commitDetail(commitId),
    queryFn: () => api.get<CommitDetail>(`/commits/${commitId}/detail`),
    enabled: open,
  });

  const close = () => {
    params.delete("commit");
    setParams(params, { replace: true });
  };

  const attach = useMutation({
    mutationFn: (taskId: number) =>
      api.post<unknown>(`/commits/${commitId}/link/attach`, { task_id: taskId }),
    onSuccess: () => {
      toast.success("Commit attached");
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "projects" && q.queryKey[2] === "gantt",
      });
      qc.invalidateQueries({ queryKey: qk.commitDetail(commitId) });
      qc.invalidateQueries({ queryKey: ["tasks"] }); // refresh any open task's commit list
      close();
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not attach commit"),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {isPending ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <div className="p-4">
            <ErrorAlert message="Could not load this commit." />
          </div>
        ) : commit ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">
                  {shortSha(commit.sha)}
                </span>
                <span className="font-mono text-xs tabular-nums">
                  <span className="text-success">+{commit.additions}</span>{" "}
                  <span className="text-destructive">−{commit.deletions}</span>
                </span>
              </SheetTitle>
              <SheetDescription className="text-left text-base font-medium text-foreground">
                {commit.summary || "No analysis summary."}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              <div className="flex flex-wrap gap-1.5">
                {commit.author_name ? <Badge variant="secondary">{commit.author_name}</Badge> : null}
                <Badge variant="outline">{formatDateTime(commit.authored_at)}</Badge>
                {commit.linked_task_id ? (
                  <Badge>Attached · #{commit.linked_task_id}</Badge>
                ) : null}
              </div>

              {commit.analysis?.changes?.length ? (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Changes
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {commit.analysis.changes.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {commit.message ? (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Commit message
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{commit.message}</p>
                </div>
              ) : null}

              {/* Manual attach: any of the author's tasks (covering sprint first). */}
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Attach to a task
                  {commit.sprint_name ? (
                    <span className="ml-1 normal-case font-normal">
                      · commit falls in {commit.sprint_name}
                    </span>
                  ) : null}
                </div>
                {commit.candidates.length ? (
                  (() => {
                    const q = search.trim().toLowerCase();
                    const rows = q
                      ? commit.candidates.filter(
                          (t) =>
                            t.key.toLowerCase().includes(q) ||
                            t.title.toLowerCase().includes(q) ||
                            (t.sprint_name || "").toLowerCase().includes(q),
                        )
                      : commit.candidates;
                    return (
                      <>
                        <Input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search tasks by key, title, or sprint…"
                          className="mb-2 h-8"
                        />
                        <ul className="max-h-80 space-y-2 overflow-y-auto">
                          {rows.map((t) => {
                            const isLinked = commit.linked_task_id === t.id;
                            return (
                              <li
                                key={t.id}
                                className="flex items-start gap-2 rounded-md border px-2.5 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      {t.key}
                                    </span>
                                    {taskCategoryBadge(t.status_category)}
                                    {t.sprint_name ? (
                                      <span className="text-[10px] text-muted-foreground">
                                        {t.sprint_name}
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-0.5 text-sm break-words">{t.title}</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant={isLinked ? "secondary" : "outline"}
                                  className="shrink-0"
                                  disabled={isLinked || attach.isPending}
                                  onClick={() => attach.mutate(t.id)}
                                >
                                  <Link2 className="size-4" />
                                  {isLinked ? "Attached" : "Attach"}
                                </Button>
                              </li>
                            );
                          })}
                          {rows.length === 0 ? (
                            <li className="px-1 py-2 text-sm text-muted-foreground">
                              No tasks match "{search}".
                            </li>
                          ) : null}
                        </ul>
                      </>
                    );
                  })()
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No candidate tasks — the commit's author isn't mapped to a member, or that member
                    has no tasks in this project.
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="p-4">
            <EmptyState icon={Link2} title="Commit not found" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
