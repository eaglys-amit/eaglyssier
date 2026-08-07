import { useQuery } from "@tanstack/react-query";
import { FolderX } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ProjectDetail } from "@/types/api";

import { CommitSheet } from "@/features/project-detail/CommitSheet";
import { TaskSheet } from "@/features/project-detail/TaskSheet";
import { PROJECT_SETTINGS, type SettingsSection } from "@/features/project-detail/settings-nav";
import { ActivityTab } from "@/features/project-detail/tabs/ActivityTab";
import { IntegrationsTab } from "@/features/project-detail/tabs/IntegrationsTab";
import { ProjectMembersTab } from "@/features/project-detail/tabs/ProjectMembersTab";
import { ProviderTab } from "@/features/project-detail/tabs/ProviderTab";

/**
 * One project setup page — provider, integrations, members, or activity. Each
 * stands on its own: reached from the project title bar, and returning there is
 * the only navigation, so none of them is a tab of the others.
 */
export function ProjectSettingsPage({ section }: { section: SettingsSection }) {
  const { projectId: projectIdParam } = useParams();
  const projectId = Number(projectIdParam);
  const current = PROJECT_SETTINGS.find((s) => s.key === section)!;

  const { data: project, isPending, error } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
    enabled: Number.isFinite(projectId),
  });

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="p-6 pt-16">
        <EmptyState
          icon={FolderX}
          title="Project not found"
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/projects">Back to projects</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        backTo={`/projects/${projectId}/data`}
        backLabel={project?.name ?? "Project"}
        icon={current.icon}
        title={current.label}
      />
      <div className="p-6">
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{current.blurb}</p>
        {isPending || !project ? (
          <TableSkeleton rows={8} />
        ) : (
          <>
            {section === "provider" && <ProviderTab projectId={projectId} project={project} />}
            {section === "integrations" && <IntegrationsTab projectId={projectId} />}
            {section === "members" && <ProjectMembersTab projectId={projectId} />}
            {section === "activity" && <ActivityTab projectId={projectId} />}
          </>
        )}
      </div>

      <TaskSheet />
      <CommitSheet />
    </>
  );
}
