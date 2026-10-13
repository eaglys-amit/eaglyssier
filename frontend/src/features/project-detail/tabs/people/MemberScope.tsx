import { useQuery } from "@tanstack/react-query";
import { RotateCcw, SlidersHorizontal } from "lucide-react";

import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          Data scope
          {editable ? (
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" /> Reset to everything
            </Button>
          ) : null}
        </CardTitle>
        <CardDescription>
          {describeScope(scope)}. Leave a list unticked to use all of it.
          {editable ? " Saved automatically." : " Only a tech lead or project manager can change it."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
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
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sprints ({scope.sprint_ids.length || "all"})
            </legend>
            {sprints.length ? (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {sprints.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent/40">
                    <Checkbox checked={scope.sprint_ids.includes(s.id)} disabled={!editable}
                              onCheckedChange={() => toggleSprint(s.id)} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(s.start_date)} → {formatDate(s.end_date)}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No sprints synced.</p>
            )}
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Repositories ({scope.repo_ids.length || "all"})
            </legend>
            {repos.length ? (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {repos.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent/40">
                    <Checkbox checked={scope.repo_ids.includes(r.id)} disabled={!editable}
                              onCheckedChange={() => toggleRepo(r.id)} />
                    <PlatformIcon platform={r.provider} size={14} />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No repositories synced.</p>
            )}
          </fieldset>
        </div>
      </CardContent>
    </Card>
  );
}
