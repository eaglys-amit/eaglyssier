import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ProjectMembers } from "@/types/api";

const EVERYONE = "all";

function useProjectMembers(projectId: number) {
  return useQuery({
    queryKey: qk.projectMembers(projectId),
    queryFn: () => api.get<ProjectMembers>(`/projects/${projectId}/members`),
  });
}

/**
 * Narrows what the Data views show to one person's tasks / commits / PRs.
 * A view filter only — nothing is saved. (What a member's KPI and evaluation
 * are generated from is set on the People tab.)
 */
export function PersonFilter({
  projectId,
  personId,
  onChange,
}: {
  projectId: number;
  personId: number | null;
  onChange: (id: number | null) => void;
}) {
  const { data } = useProjectMembers(projectId);
  return (
    <Select
      value={personId != null ? String(personId) : EVERYONE}
      onValueChange={(v) => onChange(v === EVERYONE ? null : Number(v))}
    >
      <SelectTrigger size="sm" className="w-44" aria-label="Show work by">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EVERYONE}>Everyone</SelectItem>
        {(data?.members ?? []).map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Work by an unmapped account is invisible to the person filter, so say so —
 * but only while a person is selected, when it actually hides something.
 */
export function UnmappedAccountsHint({
  projectId,
  personId,
}: {
  projectId: number;
  personId: number | null;
}) {
  const { data } = useProjectMembers(projectId);
  const unmapped =
    data?.identities.reduce((n, p) => n + p.accounts.filter((a) => a.member_id == null).length, 0) ?? 0;
  if (personId == null || unmapped === 0) return null;
  return (
    <p className="shrink-0 text-xs text-muted-foreground">
      {unmapped} synced account{unmapped === 1 ? " isn't" : "s aren't"} mapped to a member —{" "}
      <Link to={`/projects/${projectId}/members`} className="text-primary hover:underline">
        map them
      </Link>{" "}
      so their work shows here.
    </p>
  );
}
