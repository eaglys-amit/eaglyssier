import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { AnalysisScope, ProjectMembers } from "@/types/api";

const NONE = "none";

function count(n: number, all: string, unit: string) {
  return n === 0 ? all : `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function ScopeBar({
  projectId,
  activeMemberId,
  onSelectMember,
  scope,
  onUpdate,
  onReset,
}: {
  projectId: number;
  activeMemberId: number | null;
  onSelectMember: (id: number | null) => void;
  scope: AnalysisScope;
  onUpdate: (patch: Partial<AnalysisScope>) => void;
  onReset: () => void;
}) {
  const { data: members } = useQuery({
    queryKey: qk.projectMembers(projectId),
    queryFn: () => api.get<ProjectMembers>(`/projects/${projectId}/members`),
  });

  const hasMember = activeMemberId != null;
  const unmapped =
    members?.identities.reduce(
      (n, p) => n + p.accounts.filter((a) => a.member_id == null).length,
      0,
    ) ?? 0;

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Configure member</Label>
          <Select
            value={hasMember ? String(activeMemberId) : NONE}
            onValueChange={(v) => onSelectMember(v === NONE ? null : Number(v))}
          >
            <SelectTrigger size="sm" className="w-52">
              <SelectValue placeholder="Select a member…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Browse all (no member)</SelectItem>
              {(members?.members ?? []).map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="scope-start" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="scope-start"
            type="date"
            disabled={!hasMember}
            value={scope.start_date ?? ""}
            onChange={(e) => onUpdate({ start_date: e.target.value || null })}
            className="h-8 w-38"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="scope-end" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="scope-end"
            type="date"
            disabled={!hasMember}
            value={scope.end_date ?? ""}
            onChange={(e) => onUpdate({ end_date: e.target.value || null })}
            className="h-8 w-38"
          />
        </div>

        {hasMember ? (
          <div className="ml-auto flex items-center gap-3 pb-1">
            <span className="hidden text-xs text-muted-foreground md:inline">
              {count(scope.sprint_ids.length, "all sprints", "sprint")} ·{" "}
              {count(scope.repo_ids.length, "all repos", "repo")}
              {scope.start_date || scope.end_date
                ? ` · ${scope.start_date ?? "…"} → ${scope.end_date ?? "…"}`
                : ""}
            </span>
            <Button variant="ghost" size="sm" onClick={onReset}>
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {hasMember
          ? "Saved automatically for this member — check the sprints/repos below and set a date range to scope their KPI & Evaluation generation."
          : "Select a member to choose the sprints, repos, and date range used when generating their KPI & Evaluation."}
        {unmapped > 0 ? (
          <>
            {" "}
            {unmapped} synced account{unmapped === 1 ? " isn't" : "s aren't"} mapped to a
            member yet —{" "}
            <Link
              to={`/projects/${projectId}/members`}
              className="text-primary underline-offset-2 hover:underline"
            >
              map them on the Members tab
            </Link>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}
