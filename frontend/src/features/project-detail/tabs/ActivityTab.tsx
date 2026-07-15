import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { syncRunBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { SyncRunListItem } from "@/types/api";

const LABELS: Record<string, string> = {
  jira: "Jira",
  github: "GitHub",
  gitlab: "GitLab",
  slack: "Slack",
  google: "Google Workspace",
};

export function ActivityTab({ projectId }: { projectId: number }) {
  const { data: runs } = useQuery({
    queryKey: qk.syncRuns(projectId),
    queryFn: () => api.get<SyncRunListItem[]>(`/projects/${projectId}/sync-runs`),
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.status === "running") ? 2000 : false,
  });

  if (!runs?.length) {
    return (
      <EmptyState
        icon={History}
        title="No sync activity yet"
        hint="Trigger a sync on the Data tab; the most recent runs are listed here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Integration</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead>Result</TableHead>
              <TableHead className="w-44">Started</TableHead>
              <TableHead className="w-44">Finished</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <span className="flex items-center gap-2 font-medium">
                    <PlatformIcon platform={r.integration_type} />
                    {LABELS[r.integration_type] ?? r.integration_type}
                  </span>
                </TableCell>
                <TableCell>{syncRunBadge(r.status)}</TableCell>
                <TableCell className="max-w-md truncate text-xs text-muted-foreground">
                  {r.error
                    ? r.error
                    : r.stats && Object.keys(r.stats).length
                      ? Object.entries(r.stats)
                          .map(([k, v]) => `${v} ${k}`)
                          .join(" · ")
                      : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDateTime(r.started_at)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDateTime(r.finished_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
