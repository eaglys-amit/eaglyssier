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
import { Switch } from "@/components/ui/switch";
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
import { useAccess } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import type { Report, Sprint } from "@/types/api";

import { useProject } from "@/features/project-detail/ProjectShell";
import { TabShell } from "@/features/project-detail/TabShell";

type ScopeMode = "project" | "sprints" | "dates";
type ReportKind = "standard" | "executive";

const TYPE_LABELS: Record<string, string> = {
  sprint: "Sprint",
  project: "Project",
  executive: "Executive",
};

/** The Monday executive report for this project: on or off. */
function WeeklyExecutiveToggle({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { project } = useProject();
  const toggle = useMutation({
    mutationFn: (weekly: boolean) =>
      api.put(`/projects/${projectId}/reports/executive-schedule`, { weekly }),
    onSuccess: (_, weekly) => {
      qc.invalidateQueries({ queryKey: qk.project(projectId), exact: true });
      toast.success(weekly ? "Weekly executive report turned on" : "Weekly executive report turned off");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not change the schedule"),
  });
  return (
    <Label className="flex items-start gap-3 rounded-md border px-3 py-2.5 font-normal">
      <Switch
        checked={project?.exec_report_weekly ?? false}
        disabled={!project || toggle.isPending}
        onCheckedChange={(v) => toggle.mutate(v)}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm">Generate every Monday</span>
        <span className="block text-xs text-muted-foreground">
          Covers the previous 7 days and appears in the list below (needs the server's
          scheduler enabled).
        </span>
      </span>
    </Label>
  );
}

function GenerateReportCard({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { role } = useAccess(projectId);
  // The executive summary is what a VP reads; everyone else starts on the full report.
  const [kind, setKind] = useState<ReportKind>(role === "vp_product" ? "executive" : "standard");
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
        report_type: kind,
        scope_mode: mode,
        sprint_ids: mode === "sprints" ? [...sprintIds] : [],
        start: mode === "dates" && start ? start : null,
        end: mode === "dates" && end ? end : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reports(projectId) });
      toast.success(
        kind === "executive"
          ? "Executive report queued — the AI summary can take a minute"
          : "Report queued — it appears below while generating",
      );
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
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["standard", "Standard", "Full delivery detail: sprints, tasks, flow, members, git."],
              [
                "executive",
                "Executive summary",
                "For product leadership: health, what shipped, roadmap forecast, risks and decisions. Uses the AI provider.",
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={
                "rounded-md border px-3 py-2.5 text-left transition-colors " +
                (kind === value ? "border-primary bg-primary/5" : "hover:bg-accent/40")
              }
            >
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>

        <div className="text-xs font-medium text-muted-foreground">
          {kind === "executive" ? "Period covered by “what shipped” and delivery numbers" : "Scope"}
        </div>
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

        {kind === "executive" ? <WeeklyExecutiveToggle projectId={projectId} /> : null}

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
  const canReport = useAccess(projectId).can("report");
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
    <TabShell tab="reports">
      <div className="space-y-6">
        {canReport ? <GenerateReportCard projectId={projectId} /> : null}

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
                        <TableCell className="text-muted-foreground">
                          {TYPE_LABELS[r.report_type] ?? r.report_type}
                        </TableCell>
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
                            {canReport ? (
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
                            ) : null}
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
    </TabShell>
  );
}
