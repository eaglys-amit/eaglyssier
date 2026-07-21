import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ProjectIntegrations } from "@/types/api";

import { ReposSection } from "@/features/project-detail/tabs/data/ReposSection";
import { ScopeBar } from "@/features/project-detail/tabs/data/ScopeBar";
import { SprintsSection } from "@/features/project-detail/tabs/data/SprintsSection";
import { SOURCE_LABELS, SyncCards } from "@/features/project-detail/tabs/data/SyncCards";
import { useMemberScope } from "@/features/project-detail/tabs/data/useAnalysisScope";

export function DataTab({ projectId }: { projectId: number }) {
  const [params, setParams] = useSearchParams();
  const { data: integrations } = useQuery({
    queryKey: qk.integrations(projectId),
    queryFn: () => api.get<ProjectIntegrations>(`/projects/${projectId}/integrations`),
  });

  const activeMemberId = Number(params.get("member")) || null;
  const { scope, update, toggleSprint, toggleRepo, reset } = useMemberScope(
    projectId,
    activeMemberId,
  );

  const selectMember = (id: number | null) => {
    if (id == null) params.delete("member");
    else params.set("member", String(id));
    setParams(params, { replace: true });
  };

  const configured = integrations?.items.filter((i) => i.type in SOURCE_LABELS) ?? [];
  const requested = params.get("source");
  // Selected card drives which data loads below; default to the first
  // configured integration. No integrations -> show everything that exists.
  const selected =
    requested && configured.some((i) => i.type === requested)
      ? requested
      : (configured[0]?.type ?? null);

  const select = (type: string) => {
    params.set("source", type);
    setParams(params, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Row 1: member filter — common control bar for both Jira and repositories. */}
      <ScopeBar
        projectId={projectId}
        activeMemberId={activeMemberId}
        onSelectMember={selectMember}
        scope={scope}
        onUpdate={update}
        onReset={reset}
      />
      {/* Row 2: Jira / GitHub / GitLab source selector. */}
      <SyncCards projectId={projectId} selected={selected} onSelect={select} />
      {(selected === null || selected === "jira") && (
        <SprintsSection
          projectId={projectId}
          activeMemberId={activeMemberId}
          scope={scope}
          onToggleSprint={toggleSprint}
        />
      )}
      {selected === null && (
        <ReposSection
          projectId={projectId}
          activeMemberId={activeMemberId}
          scope={scope}
          onToggleRepo={toggleRepo}
        />
      )}
      {(selected === "github" || selected === "gitlab") && (
        <ReposSection
          projectId={projectId}
          provider={selected}
          activeMemberId={activeMemberId}
          scope={scope}
          onToggleRepo={toggleRepo}
        />
      )}
    </div>
  );
}
