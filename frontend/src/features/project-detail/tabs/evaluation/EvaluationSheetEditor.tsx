import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, RefreshCw, Save, Sparkles, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Spinner } from "@/components/shared/Spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { AxisCells, EvaluationSheet, EvaluationSummary, Grade } from "@/types/api";

import { ChecklistPanel } from "./ChecklistPanel";
import { AXES, GRADES } from "./constants";

const EMPTY_CELLS: AxisCells = {
  planned_goal: "",
  key_results: "",
  self_eval: null,
  tech_lead_eval: null,
  final_eval: null,
};

interface LocalSheet {
  tech_lead_name: string;
  axes: Record<string, AxisCells>;
  evidence: string;
}

function toLocal(sheet: EvaluationSheet): LocalSheet {
  const axes: Record<string, AxisCells> = {};
  for (const axis of AXES) {
    axes[axis.key] = { ...EMPTY_CELLS, ...(sheet.axes[axis.key] ?? {}) };
  }
  return {
    tech_lead_name: sheet.tech_lead_name ?? "",
    axes,
    evidence: sheet.evidence ?? "",
  };
}

const JOB_LABELS: Record<string, string> = {
  goals: "planned goals",
  results: "key results",
  checklist: "checklist",
};

function GradeSelect({
  value,
  onChange,
  disabled,
}: {
  value: Grade | null;
  onChange: (v: Grade | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(v) => onChange(v === "none" ? null : (v as Grade))}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-[92px] font-mono">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">—</SelectItem>
        {GRADES.map((g) => (
          <SelectItem key={g.value} value={g.value}>
            {g.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EvaluationSheetEditor({
  projectId,
  memberId,
  members,
  onSelectMember,
}: {
  projectId: number;
  memberId: number;
  members: EvaluationSummary[];
  onSelectMember: (memberId: number) => void;
}) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<LocalSheet | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: sheet, error } = useQuery({
    queryKey: qk.evaluationSheet(projectId, memberId),
    queryFn: () =>
      api.get<EvaluationSheet>(`/projects/${projectId}/evaluation/${memberId}`),
    refetchInterval: (q) => (q.state.data?.job_status === "running" ? 2000 : false),
  });

  // Seed/refresh the editable copy from the server whenever we're not dirty.
  // (The parent remounts this component per member via key={memberId}.)
  useEffect(() => {
    if (sheet && !dirty) setLocal(toLocal(sheet));
  }, [sheet, dirty]);

  const running = sheet?.job_status === "running";

  const edit = (patch: Partial<LocalSheet>) => {
    setLocal((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };
  const updateAxis = (key: string, patch: Partial<AxisCells>) => {
    setLocal((prev) =>
      prev
        ? { ...prev, axes: { ...prev.axes, [key]: { ...prev.axes[key], ...patch } } }
        : prev,
    );
    setDirty(true);
  };

  const onJobResult = (result: EvaluationSheet) => {
    qc.setQueryData(qk.evaluationSheet(projectId, memberId), result);
    qc.invalidateQueries({ queryKey: qk.evaluation(projectId), exact: true });
  };

  const save = useMutation({
    mutationFn: (body: LocalSheet) =>
      api.put<EvaluationSheet>(`/projects/${projectId}/evaluation/${memberId}`, {
        tech_lead_name: body.tech_lead_name || null,
        axes: body.axes,
        evidence: body.evidence || null,
      }),
    onSuccess: (result) => {
      setDirty(false);
      onJobResult(result);
      toast.success("Evaluation sheet saved");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save the sheet"),
  });

  const job = useMutation({
    mutationFn: (kind: "generate-goals" | "generate-results" | "validate") =>
      api.post<EvaluationSheet>(
        `/projects/${projectId}/evaluation/${memberId}/${kind}`,
        {},
      ),
    onSuccess: (result, kind) => {
      onJobResult(result);
      toast.success(
        kind === "validate" ? "Checklist check started" : "Generation started",
      );
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start the job"),
  });

  if (error instanceof ApiError) {
    return <ErrorAlert message={error.detail || "Could not load the evaluation sheet."} />;
  }
  if (!sheet || !local) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Spinner /> Loading evaluation sheet…
        </CardContent>
      </Card>
    );
  }

  const generationFinishedWhileDirty =
    dirty && !running && (sheet.job_status === "ready" || sheet.job_status === "failed");
  const busy = running || job.isPending;
  // Server-maintained flag: set whenever goals/results change after a check.
  const checklistStale = !!sheet.checklist?.stale;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              Project Evaluation
              <Select
                value={String(memberId)}
                onValueChange={(v) => onSelectMember(Number(v))}
              >
                <SelectTrigger className="h-8 w-[220px] font-normal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.member_id} value={String(m.member_id)}>
                      {m.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sheet.job_model ? (
                <span className="text-xs font-normal text-muted-foreground">
                  {sheet.job_model}
                </span>
              ) : null}
            </span>
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => job.mutate("generate-goals")}
              >
                <Target className="size-4" /> Generate Goals
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => job.mutate("generate-results")}
              >
                <Sparkles className="size-4" /> Generate Results
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || dirty}
                title={dirty ? "Save your edits first" : undefined}
                onClick={() => job.mutate("validate")}
              >
                <ClipboardCheck className="size-4" /> Run Checklist
              </Button>
              <Button
                size="sm"
                disabled={!dirty || busy || save.isPending}
                onClick={() => save.mutate(local)}
              >
                <Save className="size-4" /> Save
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs text-muted-foreground">PJT Code</Label>
              <p className="text-sm font-medium">{sheet.project_key ?? "—"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">PJT Name</Label>
              <p className="text-sm font-medium">{sheet.project_name}</p>
            </div>
            <div>
              <Label htmlFor="tech-lead" className="text-xs text-muted-foreground">
                Name of Tech Lead
              </Label>
              <Input
                id="tech-lead"
                className="mt-0.5 h-8"
                value={local.tech_lead_name}
                disabled={running}
                onChange={(e) => edit({ tech_lead_name: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Goals generated: {formatDateTime(sheet.goals_generated_at)}</span>
            <span>Results generated: {formatDateTime(sheet.results_generated_at)}</span>
            <span>Checked: {formatDateTime(sheet.checked_at)}</span>
          </div>

          {running ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              <Spinner /> Generating {JOB_LABELS[sheet.job_kind ?? ""] ?? "…"} — the sheet
              will refresh when done.
            </div>
          ) : null}
          {sheet.job_status === "failed" && sheet.job_error ? (
            <ErrorAlert message={sheet.job_error} />
          ) : null}
          {generationFinishedWhileDirty ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <span>
                A background job finished while you had unsaved edits. Reload to see its
                output (discards your edits), or Save to keep yours.
              </span>
              <Button size="sm" variant="outline" onClick={() => setDirty(false)}>
                <RefreshCw className="size-4" /> Reload
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[190px]">Focus Area</TableHead>
                <TableHead className="min-w-[280px]">Planned Goal</TableHead>
                <TableHead className="min-w-[280px]">Key Results & Achievements</TableHead>
                <TableHead className="w-[100px]">Self Eval</TableHead>
                <TableHead className="w-[100px]">Tech Lead Eval</TableHead>
                <TableHead className="w-[100px]">Final Eval</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AXES.map((axis) => {
                const cells = local.axes[axis.key];
                return (
                  <TableRow key={axis.key}>
                    <TableCell className="align-top">
                      <div className="font-medium">{axis.label}</div>
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        {axis.bucket}≒
                      </Badge>
                      <p className="mt-1.5 text-xs text-muted-foreground">{axis.hint}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      <Textarea
                        rows={6}
                        className="min-h-28 text-sm"
                        value={cells.planned_goal}
                        disabled={running}
                        onChange={(e) => updateAxis(axis.key, { planned_goal: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Textarea
                        rows={6}
                        className="min-h-28 text-sm"
                        value={cells.key_results}
                        disabled={running}
                        onChange={(e) => updateAxis(axis.key, { key_results: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <GradeSelect
                        value={cells.self_eval}
                        disabled={running}
                        onChange={(v) => updateAxis(axis.key, { self_eval: v })}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <GradeSelect
                        value={cells.tech_lead_eval}
                        disabled={running}
                        onChange={(v) => updateAxis(axis.key, { tech_lead_eval: v })}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <GradeSelect
                        value={cells.final_eval}
                        disabled={running}
                        onChange={(v) => updateAxis(axis.key, { final_eval: v })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Evidence of Outcomes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            placeholder={
              "One item per line: GitHub repository URLs, PR numbers, Jira keys, test reports, demo videos, customer feedback…"
            }
            value={local.evidence}
            disabled={running}
            onChange={(e) => edit({ evidence: e.target.value })}
          />
        </CardContent>
      </Card>

      {sheet.checklist ? (
        <ChecklistPanel
          checklist={sheet.checklist}
          checkedAt={sheet.checked_at}
          stale={checklistStale}
        />
      ) : null}
    </div>
  );
}
