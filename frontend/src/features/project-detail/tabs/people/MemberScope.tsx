import { useQuery } from "@tanstack/react-query";
import { RotateCcw, SlidersHorizontal } from "lucide-react";

import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { SectionPanel } from "@/components/shared/SectionPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import type { AnalysisScope, Repo, Sprint } from "@/types/api";

import { useMemberScope } from "./useMemberScope";

function plural(n: number, unit: string, none: string) {
  return n === 0 ? none : `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function describeScope(scope: AnalysisScope): string {
  const dates =
    scope.start_date || scope.end_date
      ? `${scope.start_date ?? "…"} → ${scope.end_date ?? "…"}`
      : "any dates";
  return [
    plural(scope.sprint_ids.length, "sprint", "all sprints"),
    plural(scope.repo_ids.length, "repo", "all repos"),
    dates,
  ].join(" · ");
}

/** "Data used: 3 sprints · 2 repos · …  [Edit]" — shown beside what consumes it. */
export function ScopeSummary({ projectId, memberId, onEdit }: {
  projectId: number;
  memberId: number;
  onEdit: () => void;
}) {
  const { scope } = useMemberScope(projectId, memberId);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <SlidersHorizontal className="size-3.5" />
      <span>
        Generated from: <span className="text-foreground">{describeScope(scope)}</span>
      </span>
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onEdit}>
        {useAccess(projectId).can("people_manage") ? "Edit" : "View"}
      </Button>
    </div>
  );
}

/**
 * The sprints, repositories and dates this member's KPI and evaluation are
 * generated from. Saved on every change. Nothing ticked means everything.
 *
 * Laid out like the Data tab: a fixed strip for the dates, then the two lists
 * as panels that fill the rest of the height and scroll inside.
 */
export function ScopeEditor({ projectId, memberId }: { projectId: number; memberId: number }) {
  const editable = useAccess(projectId).can("people_manage");
  const { scope, update, toggleSprint, toggleRepo, reset } = useMemberScope(projectId, memberId);
  const { data: sprints = [] } = useQuery({
    queryKey: qk.sprints(projectId),
    queryFn: () => api.get<Sprint[]>(`/projects/${projectId}/sprints`),
  });
  const { data: repos = [] } = useQuery({
    queryKey: qk.repos(projectId),
    queryFn: () => api.get<Repo[]>(`/projects/${projectId}/repos`),
  });
  // Stacked below lg, where the page scrolls: cap each list instead.
  const panel = "max-lg:h-auto max-lg:max-h-96";
  const ticked = (n: number) => (
    <span className="text-xs text-muted-foreground">
      {n ? `${n} ticked` : "None ticked — all are used"}
    </span>
  );

  return (
    <div className="flex flex-col gap-4 lg:h-full">
      <div className="flex shrink-0 flex-wrap items-end gap-4 rounded-lg border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Data scope</div>
          <div className="text-xs text-muted-foreground">
            {describeScope(scope)}.{" "}
            {editable ? "Saved automatically." : "Only a tech lead or project manager can change it."}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="scope-start" className="text-xs text-muted-foreground">From</Label>
          <Input id="scope-start" type="date" className="h-8 w-40" disabled={!editable}
                 value={scope.start_date ?? ""}
                 onChange={(e) => update({ start_date: e.target.value || null })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="scope-end" className="text-xs text-muted-foreground">To</Label>
          <Input id="scope-end" type="date" className="h-8 w-40" disabled={!editable}
                 value={scope.end_date ?? ""}
                 onChange={(e) => update({ end_date: e.target.value || null })} />
        </div>
        {editable ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" /> Reset to everything
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <SectionPanel title="Sprints" count={sprints.length || undefined}
                      subtitle={ticked(scope.sprint_ids.length)} flush={sprints.length > 0}
                      className={panel}>
          {sprints.length ? (
            <ul className="divide-y">
              {sprints.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40">
                    <Checkbox checked={scope.sprint_ids.includes(s.id)} disabled={!editable}
                              onCheckedChange={() => toggleSprint(s.id)} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(s.start_date)} → {formatDate(s.end_date)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No sprints synced.</p>
          )}
        </SectionPanel>
        <SectionPanel title="Repositories" count={repos.length || undefined}
                      subtitle={ticked(scope.repo_ids.length)} flush={repos.length > 0}
                      className={panel}>
          {repos.length ? (
            <ul className="divide-y">
              {repos.map((r) => (
                <li key={r.id}>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40">
                    <Checkbox checked={scope.repo_ids.includes(r.id)} disabled={!editable}
                              onCheckedChange={() => toggleRepo(r.id)} />
                    <PlatformIcon platform={r.provider} size={14} />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No repositories synced.</p>
          )}
        </SectionPanel>
      </div>
    </div>
  );
}
