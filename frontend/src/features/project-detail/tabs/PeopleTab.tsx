import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { jobBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABELS, useAccess } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { EvaluationSummary, Kpi, ProjectMembers } from "@/types/api";

import { TabShell } from "@/features/project-detail/TabShell";
import { EvaluationSheetEditor } from "./evaluation/EvaluationSheetEditor";
import { KpiPanel } from "./people/KpiPanel";
import { ScopeEditor, ScopeSummary } from "./people/MemberScope";

export type PeopleSection = "scope" | "kpi" | "evaluation";
const SECTIONS: { key: PeopleSection; label: string }[] = [
  { key: "scope", label: "Data scope" },
  { key: "kpi", label: "KPI" },
  { key: "evaluation", label: "Evaluation" },
];

function evaluationChip(s: EvaluationSummary | undefined) {
  if (!s || !s.has_sheet) return <span className="text-[11px] text-muted-foreground">Eval —</span>;
  if (s.job_status === "running") return <StatusBadge variant="running" label="Eval" spinning />;
  if (s.checklist_verdict === "pass" && !s.checklist_stale) return <StatusBadge variant="success" label="Eval ✓" />;
  if (s.checklist_verdict === "fail") return <StatusBadge variant="warning" label="Eval ✗" />;
  return <StatusBadge variant="neutral" label="Eval draft" />;
}

/**
 * Everything per person in one place: the data their KPI and evaluation are
 * built from, the KPI, and the evaluation sheet. Developers see only
 * themselves; tech leads and project managers see the whole team.
 */
export function PeopleTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const canManage = useAccess(projectId).can("people_manage");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: kpis } = useQuery({
    queryKey: qk.kpi(projectId),
    queryFn: () => api.get<Kpi[]>(`/projects/${projectId}/kpi`),
    refetchInterval: (q) => (q.state.data?.some((k) => k.status === "running") ? 2000 : false),
  });
  const { data: evaluations } = useQuery({
    queryKey: qk.evaluation(projectId),
    queryFn: () => api.get<EvaluationSummary[]>(`/projects/${projectId}/evaluation`),
    refetchInterval: (q) => (q.state.data?.some((e) => e.job_status === "running") ? 2000 : false),
  });
  const { data: members } = useQuery({
    queryKey: qk.projectMembers(projectId),
    queryFn: () => api.get<ProjectMembers>(`/projects/${projectId}/members`),
  });

  const generate = useMutation({
    mutationFn: (memberIds: number[]) =>
      api.post<Kpi[]>(`/projects/${projectId}/kpi`, { member_ids: memberIds }),
    onSuccess: (list) => {
      qc.setQueryData(qk.kpi(projectId), list);
      setSelected(new Set());
      toast.success("KPI generation started");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not start KPI generation"),
  });

  const set = (patch: Record<string, string>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      Object.entries(patch).forEach(([k, v]) => next.set(k, v));
      return next;
    }, { replace: true });

  if (!kpis) {
    return (
      <TabShell tab="people">
        <TableSkeleton rows={6} />
      </TabShell>
    );
  }
  if (!kpis.length) {
    return (
      <TabShell tab="people">
        <EmptyState icon={Users} title="No members on this project"
                    hint="Add members under Members in the sidebar first." />
      </TabShell>
    );
  }

  const paramId = Number(params.get("member"));
  const activeId = kpis.some((k) => k.member_id === paramId) ? paramId : kpis[0].member_id;
  const active = kpis.find((k) => k.member_id === activeId)!;
  const section = (SECTIONS.find((s) => s.key === params.get("section"))?.key ?? "kpi") as PeopleSection;
  const roleOf = (id: number) => members?.members.find((m) => m.id === id)?.role;
  const evalOf = (id: number) => evaluations?.find((e) => e.member_id === id);
  const allSelected = selected.size === kpis.length;
  const summary = (
    <ScopeSummary projectId={projectId} memberId={activeId} onEdit={() => set({ section: "scope" })} />
  );
  const activeRole = roleOf(activeId);

  return (
    <TabShell tab="people">
      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        <Card className="self-start">
          <CardContent className="space-y-1 p-2">
            {canManage && kpis.length > 1 ? (
              <label className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <Checkbox checked={allSelected}
                          onCheckedChange={(v) => setSelected(v === true ? new Set(kpis.map((k) => k.member_id)) : new Set())} />
                Select all
              </label>
            ) : null}
            {kpis.map((k) => {
              const role = roleOf(k.member_id);
              return (
                <div key={k.member_id}
                     className={cn("flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5",
                       k.member_id === activeId ? "bg-accent" : "hover:bg-accent/50")}
                     onClick={() => set({ member: String(k.member_id) })}>
                  {canManage ? (
                    <Checkbox className="mt-0.5" checked={selected.has(k.member_id)}
                              onClick={(e) => e.stopPropagation()}
                              onCheckedChange={(v) => setSelected((prev) => {
                                const next = new Set(prev);
                                if (v === true) next.add(k.member_id);
                                else next.delete(k.member_id);
                                return next;
                              })}
                              aria-label={`Select ${k.display_name} for KPI generation`} />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{k.display_name}</div>
                    {role ? <div className="text-[11px] text-muted-foreground">{ROLE_LABELS[role]}</div> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {jobBadge(k.status, { none: "KPI —", ready: "KPI ✓", running: "KPI", failed: "KPI ✗" })}
                      {evaluationChip(evalOf(k.member_id))}
                    </div>
                  </div>
                </div>
              );
            })}
            {canManage ? (
              <div className="p-2">
                <Button className="w-full" size="sm" disabled={!selected.size || generate.isPending}
                        onClick={() => generate.mutate([...selected])}>
                  <Sparkles className="size-4" /> Generate KPI {selected.size ? `(${selected.size})` : ""}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Each member's own data scope is applied.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{active.display_name}</h2>
              {activeRole ? <div className="text-xs text-muted-foreground">{ROLE_LABELS[activeRole]}</div> : null}
            </div>
            <Tabs value={section} onValueChange={(v) => set({ section: v })}>
              <TabsList>
                {SECTIONS.map((s) => (
                  <TabsTrigger key={s.key} value={s.key}>{s.label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {section === "scope" ? <ScopeEditor key={activeId} projectId={projectId} memberId={activeId} /> : null}
          {section === "kpi" ? (
            <KpiPanel projectId={projectId} kpi={active} canGenerate={canManage} scopeSummary={summary} />
          ) : null}
          {section === "evaluation" ? (
            <div className="space-y-3">
              {summary}
              <EvaluationSheetEditor key={activeId} projectId={projectId} memberId={activeId} />
            </div>
          ) : null}
        </div>
      </div>
    </TabShell>
  );
}
