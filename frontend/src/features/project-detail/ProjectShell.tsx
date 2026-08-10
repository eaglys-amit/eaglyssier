import { useQuery } from "@tanstack/react-query";
import { FolderX } from "lucide-react";
import { Link, Outlet, useOutletContext, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ProjectDetail } from "@/types/api";

import { CommitSheet } from "@/features/project-detail/CommitSheet";
import { ProjectSidebar } from "@/features/project-detail/ProjectSidebar";
import { TaskSheet } from "@/features/project-detail/TaskSheet";

type ProjectContext = { projectId: number; project: ProjectDetail };

/**
 * Everything under /projects/:projectId. It owns the one project query, the
 * sidebar, the not-found state, and the two URL-driven sheets, so the pages
 * below it — the analysis tabs and the setup sections alike — get a loaded
 * project and nothing to re-fetch.
 */
export function ProjectShell() {
  const { projectId: projectIdParam } = useParams();
  const projectId = Number(projectIdParam);

  const { data: project, error } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
    enabled: Number.isFinite(projectId),
  });

  if (error instanceof ApiError && error.status === 404) {
    return (
      <AppShell>
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
      </AppShell>
    );
  }

  const context: ProjectContext | null = project ? { projectId, project } : null;

  return (
    <>
      <AppShell sidebar={<ProjectSidebar projectId={projectId} project={project} />}>
        {context ? (
          <Outlet context={context} />
        ) : (
          <div className="p-6">
            <TableSkeleton rows={8} />
          </div>
        )}
      </AppShell>

      <TaskSheet />
      <CommitSheet />
    </>
  );
}

/** The loaded project, for any page rendered inside ProjectShell. */
export function useProject(): ProjectContext {
  return useOutletContext<ProjectContext>();
}
