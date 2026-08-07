import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
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

  // The two panels split the row 50/50; collapsing one hands its width to the
  // other. Both collapsed stays balanced rather than bunching to the left.
  const [sprintsOpen, setSprintsOpen] = useState(true);
  const [reposOpen, setReposOpen] = useState(true);
  const pane = (open: boolean) =>
    open || (!sprintsOpen && !reposOpen)
      ? "min-w-0 flex-1"
      : "min-w-0 lg:w-72 lg:shrink-0 lg:flex-none";

  // Selecting a git source narrows the repositories panel to that provider;
  // both panels stay visible either way.
  const repoProvider = selected === "github" || selected === "gitlab" ? selected : undefined;

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
      {/* Row 3: the two data domains, side by side and independently collapsible. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className={cn("transition-[flex-basis,width]", pane(sprintsOpen))}>
          <SprintsSection
            projectId={projectId}
            activeMemberId={activeMemberId}
            scope={scope}
            onToggleSprint={toggleSprint}
            open={sprintsOpen}
            onOpenChange={setSprintsOpen}
          />
        </div>
        <div className={cn("transition-[flex-basis,width]", pane(reposOpen))}>
          <ReposSection
            projectId={projectId}
            provider={repoProvider}
            activeMemberId={activeMemberId}
            scope={scope}
            onToggleRepo={toggleRepo}
            open={reposOpen}
            onOpenChange={setReposOpen}
          />
        </div>
      </div>
    </div>
  );
}
