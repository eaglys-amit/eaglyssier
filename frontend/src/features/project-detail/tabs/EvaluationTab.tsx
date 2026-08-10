import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { EvaluationSummary } from "@/types/api";

import { TabShell } from "@/features/project-detail/TabShell";

import { EvaluationSheetEditor } from "./evaluation/EvaluationSheetEditor";

export function EvaluationTab({ projectId }: { projectId: number }) {
  const [params, setParams] = useSearchParams();

  const { data: summaries } = useQuery({
    queryKey: qk.evaluation(projectId),
    queryFn: () => api.get<EvaluationSummary[]>(`/projects/${projectId}/evaluation`),
  });

  if (!summaries) {
    return (
      <TabShell tab="evaluation">
        <TableSkeleton rows={6} />
      </TabShell>
    );
  }
  if (!summaries.length) {
    return (
      <TabShell tab="evaluation">
        <EmptyState
          icon={ClipboardList}
          title="No members on this project"
          hint="Add members under Members in the sidebar first, then build per-member evaluation sheets here."
        />
      </TabShell>
    );
  }

  // Fall back to the first member when the ?member= param is stale/foreign.
  const paramId = Number(params.get("member"));
  const activeId = summaries.some((s) => s.member_id === paramId)
    ? paramId
    : summaries[0].member_id;

  return (
    <TabShell tab="evaluation">
      <EvaluationSheetEditor
        key={activeId}
        projectId={projectId}
        memberId={activeId}
        members={summaries}
        onSelectMember={(id) => {
          params.set("member", String(id));
          setParams(params, { replace: true });
        }}
      />
    </TabShell>
  );
}
