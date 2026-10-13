import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { SectionPanel } from "@/components/shared/SectionPanel";
import { jobBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Deliverables } from "@/types/api";

import { TabShell } from "@/features/project-detail/TabShell";

function deliverableStatusBadge(status: string) {
  switch (status) {
    case "done":
      return <StatusBadge variant="success" label="Done" />;
    case "in_progress":
      return <StatusBadge variant="warning" label="In progress" />;
    default:
      return <StatusBadge variant="neutral" label={status || "Planned"} />;
  }
}

export function DeliverablesTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.deliverables(projectId),
    queryFn: () => api.get<Deliverables>(`/projects/${projectId}/deliverables`),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });
  const generate = useMutation({
    mutationFn: () => api.post<Deliverables>(`/projects/${projectId}/deliverables/generate`),
    onSuccess: (d) => qc.setQueryData(qk.deliverables(projectId), d),
    onError: (err: ApiError) => toast.error(err.detail || "Could not start generation"),
  });

  const running = data?.status === "running";

  return (
    <TabShell
      flat
      tab="deliverables"
      actions={
        <>
          {data ? jobBadge(data.status, { none: "Not generated" }) : null}
          {data?.generated_at ? (
            <span className="hidden text-xs text-muted-foreground lg:inline">
              {formatDateTime(data.generated_at)}
              {data.model ? ` · ${data.model}` : ""}
            </span>
          ) : null}
          <Button size="sm" onClick={() => generate.mutate()} disabled={running || generate.isPending}>
            <Sparkles className="size-4" />
            {running ? "Generating…" : "Generate deliverables"}
          </Button>
        </>
      }
    >
      {/* Fits the screen from lg up: the table scrolls inside its panel, like
          the Data tab's lists. Narrower than that, the page scrolls. */}
      <div className="flex flex-col gap-4 lg:h-full">
        {data?.status === "failed" && data.error ? (
          <div className="shrink-0">
            <ErrorAlert message={data.error} />
          </div>
        ) : null}

        <div className="lg:min-h-0 lg:flex-1">
          <SectionPanel
            title="Deliverables"
            count={data?.items.length || undefined}
            subtitle={
              <span className="text-xs text-muted-foreground">
                Inferred from completed tasks and repository summaries. Manual rows are kept when
                you regenerate.
              </span>
            }
            flush={Boolean(data?.items.length)}
          >
            {!data?.items.length ? (
              <EmptyState
                icon={Package}
                title="No deliverables yet"
                hint="Press Generate deliverables to infer them from the project's completed work."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deliverable</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-56">Linked tasks</TableHead>
                    <TableHead className="w-20">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="max-w-md">
                        <div className="font-medium">{d.name}</div>
                        {d.description ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">{d.description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{deliverableStatusBadge(d.status)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {d.linked_task_keys.length ? (
                            d.linked_task_keys.map((k) => (
                              <Badge key={k} variant="outline" className="font-mono text-xs">
                                {k}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.source === "ai" ? "default" : "secondary"}>
                          {d.source === "ai" ? "AI" : "Manual"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionPanel>
        </div>
      </div>
    </TabShell>
  );
}
