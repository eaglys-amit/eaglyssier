import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { reportBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Report, Sprint } from "@/types/api";

type ScopeMode = "project" | "sprints" | "dates";

function GenerateReportCard({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<ScopeMode>("project");
  const [sprintIds, setSprintIds] = useState<Set<number>>(new Set());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const { data: sprints } = useQuery({
    queryKey: qk.sprints(projectId),
    queryFn: () => api.get<Sprint[]>(`/projects/${projectId}/sprints`),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<Report>(`/projects/${projectId}/reports`, {
        scope_mode: mode,
        sprint_ids: mode === "sprints" ? [...sprintIds] : [],
        start: mode === "dates" && start ? start : null,
        end: mode === "dates" && end ? end : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reports(projectId) });
      toast.success("Report queued — it appears below while generating");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not queue report"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate a report</CardTitle>
        <CardDescription>
          Sprint reviews, closing reports, and period summaries rendered to HTML and PDF.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as ScopeMode)}
          className="flex flex-wrap gap-4"
        >
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="project" /> Whole project
          </Label>
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="sprints" /> Selected sprints
          </Label>
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="dates" /> Date range
          </Label>
        </RadioGroup>

        {mode === "sprints" ? (
          sprints?.length ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sprints.map((s) => (
                <Label
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 font-normal"
                >
                  <Checkbox
                    checked={sprintIds.has(s.id)}
                    onCheckedChange={(v) =>
                      setSprintIds((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(s.id);
                        else next.delete(s.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(s.start_date)} → {formatDate(s.end_date)}
                    </span>
                  </span>
                </Label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No sprints synced yet — sync Jira on the Data tab first.
            </p>
          )
        ) : null}

        {mode === "dates" ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="report-start">From</Label>
              <Input
                id="report-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-end">To</Label>
              <Input
                id="report-end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        ) : null}

        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending || (mode === "sprints" && sprintIds.size === 0)}
        >
          <FileText className="size-4" />
          {create.isPending ? "Queuing…" : "Generate report"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function ReportsTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { data: reports } = useQuery({
    queryKey: qk.reports(projectId),
    queryFn: () => api.get<Report[]>(`/projects/${projectId}/reports`),
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.status === "pending" || r.status === "generating")
        ? 2000
        : false,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/reports/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reports(projectId) });
      toast.success("Report deleted");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete report"),
  });

  return (
    <div className="space-y-6">
      <GenerateReportCard projectId={projectId} />

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Generated reports</h2>
        {!reports?.length ? (
          <EmptyState
            icon={FileText}
            title="No reports yet"
            hint="Generate a report above; it renders to stored HTML and a downloadable PDF."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-24">Type</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-40">Generated</TableHead>
                    <TableHead className="w-44 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-sm">
                        <div className="truncate font-medium">{r.title}</div>
                        {r.status === "failed" && r.error ? (
                          <div className="truncate text-xs text-destructive">{r.error}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.report_type}</TableCell>
                      <TableCell>{reportBadge(r.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(r.generated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {r.html_url ? (
                            <Button asChild variant="ghost" size="sm">
                              <a href={r.html_url} target="_blank" rel="noreferrer">
                                <ExternalLink className="size-3.5" /> View
                              </a>
                            </Button>
                          ) : null}
                          {r.pdf_url ? (
                            <Button asChild variant="ghost" size="sm">
                              <a href={r.pdf_url}>
                                <Download className="size-3.5" /> PDF
                              </a>
                            </Button>
                          ) : null}
                          <ConfirmDialog
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="size-4" />
                                <span className="sr-only">Delete report</span>
                              </Button>
                            }
                            title={`Delete “${r.title}”?`}
                            description="Removes the report and its stored HTML/PDF."
                            onConfirm={() => remove.mutate(r.id)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
