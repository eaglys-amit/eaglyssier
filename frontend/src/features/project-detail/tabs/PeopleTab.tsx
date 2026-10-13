import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { ROLE_LABELS, useAccess } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
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

/** "KPI ✓ · Eval draft" — each member's state, shown in the person selector. */
function statusLine(kpi: Kpi, ev: EvaluationSummary | undefined): string {
  const k = { ready: "KPI ✓", running: "KPI …", failed: "KPI ✗" }[kpi.status as string] ?? "no KPI";
  let e = "no sheet";
  if (ev?.has_sheet) {
    e = ev.job_status === "running" ? "Eval …"
      : ev.checklist_verdict === "pass" && !ev.checklist_stale ? "Eval ✓"
      : ev.checklist_verdict === "fail" ? "Eval ✗"
      : "Eval draft";
  }
  return `${k} · ${e}`;
}

/**
 * Everything per person: the data their KPI and evaluation are generated
 * from, the KPI, and the evaluation sheet. Who and which part are picked in
 * the title bar; the section gets the whole column. Developers see only
 * themselves; tech leads and project managers see the whole team.
 */
export function PeopleTab({ projectId }: { projectId: number }) {
  const [params, setParams] = useSearchParams();
  const canManage = useAccess(projectId).can("people_manage");

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

  const set = (key: string, value: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set(key, value);
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
  const section =
    SECTIONS.find((s) => s.key === params.get("section"))?.key ?? ("kpi" as PeopleSection);
  const roleOf = (id: number) => members?.members.find((m) => m.id === id)?.role;
  const evalOf = (id: number) => evaluations?.find((e) => e.member_id === id);
  const summary = (
    <ScopeSummary projectId={projectId} memberId={activeId} onEdit={() => set("section", "scope")} />
  );

  const actions = (
    <div className="flex items-center gap-2">
      <Select value={String(activeId)} onValueChange={(v) => set("member", v)}>
        <SelectTrigger size="sm" className="w-52" aria-label="Person">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {kpis.map((k) => {
            const role = roleOf(k.member_id);
            return (
              <SelectItem key={k.member_id} value={String(k.member_id)}>
                {/* The trigger shows only the first line (the name); the open
                    list adds role and where each member's KPI/evaluation stands. */}
                <span className="flex flex-col">
                  <span>{k.display_name}</span>
                  <span className="text-[11px] text-muted-foreground in-data-[slot=select-value]:hidden">
                    {role ? `${ROLE_LABELS[role]} · ` : ""}
                    {statusLine(k, evalOf(k.member_id))}
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Tabs value={section} onValueChange={(v) => set("section", v)}>
        <TabsList>
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.key} value={s.key}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );

  return (
    <TabShell tab="people" actions={actions} flat>
      {section === "scope" ? (
        <ScopeEditor key={activeId} projectId={projectId} memberId={activeId} />
      ) : null}
      {section === "kpi" ? (
        <KpiPanel
          projectId={projectId}
          kpi={active}
          allMemberIds={kpis.map((k) => k.member_id)}
          canGenerate={canManage}
          scopeSummary={summary}
        />
      ) : null}
      {section === "evaluation" ? (
        <div className="space-y-3">
          {summary}
          <EvaluationSheetEditor key={activeId} projectId={projectId} memberId={activeId} />
        </div>
      ) : null}
    </TabShell>
  );
}
