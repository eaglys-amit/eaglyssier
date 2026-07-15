import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ProjectIntegrations } from "@/types/api";

import { ReposSection } from "@/features/project-detail/tabs/data/ReposSection";
import { SprintsSection } from "@/features/project-detail/tabs/data/SprintsSection";
import { SOURCE_LABELS, SyncCards } from "@/features/project-detail/tabs/data/SyncCards";

export function DataTab({ projectId }: { projectId: number }) {
  const [params, setParams] = useSearchParams();
  const { data: integrations } = useQuery({
    queryKey: qk.integrations(projectId),
    queryFn: () => api.get<ProjectIntegrations>(`/projects/${projectId}/integrations`),
  });

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
    <div className="space-y-8">
      <SyncCards projectId={projectId} selected={selected} onSelect={select} />
      {(selected === null || selected === "jira") && <SprintsSection projectId={projectId} />}
      {selected === null && <ReposSection projectId={projectId} />}
      {(selected === "github" || selected === "gitlab") && (
        <ReposSection projectId={projectId} provider={selected} />
      )}
    </div>
  );
}
