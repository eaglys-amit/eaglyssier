import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { jobBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      <div className="space-y-4">
        {data?.status === "failed" && data.error ? <ErrorAlert message={data.error} /> : null}

        {!data?.items.length ? (
          <EmptyState
            icon={Package}
            title="No deliverables yet"
            hint="Deliverables are inferred by the LLM from completed tasks and repository summaries. Manual/seeded rows are kept on regeneration."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
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
            </CardContent>
          </Card>
        )}
      </div>
    </TabShell>
  );
}
