import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";

import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { FolderX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "@/types/api";

import { TaskSheet } from "@/features/project-detail/TaskSheet";
import { ActivityTab } from "@/features/project-detail/tabs/ActivityTab";
import { CapacityTab } from "@/features/project-detail/tabs/CapacityTab";
import { DataTab } from "@/features/project-detail/tabs/DataTab";
import { DeliverablesTab } from "@/features/project-detail/tabs/DeliverablesTab";
import { EvaluationTab } from "@/features/project-detail/tabs/EvaluationTab";
import { IntegrationsTab } from "@/features/project-detail/tabs/IntegrationsTab";
import { KpiTab } from "@/features/project-detail/tabs/KpiTab";
import { ProjectMembersTab } from "@/features/project-detail/tabs/ProjectMembersTab";
import { ProviderTab } from "@/features/project-detail/tabs/ProviderTab";
import { ReportsTab } from "@/features/project-detail/tabs/ReportsTab";
import { TerminalTab } from "@/features/project-detail/tabs/TerminalTab";

const TABS = [
  { key: "data", label: "Data" },
  { key: "reports", label: "Reports" },
  { key: "deliverables", label: "Deliverables" },
  { key: "kpi", label: "KPI" },
  { key: "capacity", label: "Capacity" },
  { key: "evaluation", label: "Evaluation" },
  { key: "provider", label: "Provider" },
  { key: "integrations", label: "Integrations" },
  { key: "members", label: "Members" },
  { key: "activity", label: "Activity" },
  { key: "terminal", label: "Terminal" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function ProjectDetailLayout() {
  const { projectId: projectIdParam, tab: tabParam } = useParams();
  const projectId = Number(projectIdParam);
  const navigate = useNavigate();
  const location = useLocation();

  // Legacy deep links used /projects/3#kpi; map them onto the tab URL scheme.
  useEffect(() => {
    const hash = location.hash.replace("#", "");
    if (hash && TABS.some((t) => t.key === hash)) {
      navigate(`/projects/${projectId}/${hash}${location.search}`, { replace: true });
    } else if (!tabParam) {
      navigate(`/projects/${projectId}/data${location.search}`, { replace: true });
    }
  }, [location.hash, location.search, navigate, projectId, tabParam]);

  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "data";

  // Once the user starts a terminal session it stays mounted (hidden) across
  // tab switches so the PTY survives; it ends when they leave the project.
  const [terminalStarted, setTerminalStarted] = useState(false);

  const { data: project, isPending, error } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
    enabled: Number.isFinite(projectId),
  });

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="pt-16">
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
      <div className="mb-4">
        <Link
          to="/projects"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Projects
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {project?.name ?? (isPending ? "…" : "")}
          </h1>
          {project?.key ? <Badge variant="secondary">{project.key}</Badge> : null}
        </div>
        {project?.description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{project.description}</p>
        ) : null}
      </div>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/projects/${projectId}/${t.key}`}
            className={({ isActive }) =>
              cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      {isPending || !project ? (
        <TableSkeleton rows={8} />
      ) : (
        <>
          <div className={tab === "terminal" ? "block" : "hidden"}>
            <TerminalTab
              projectId={projectId}
              started={terminalStarted}
              onStart={() => setTerminalStarted(true)}
              onEnd={() => setTerminalStarted(false)}
            />
          </div>
          {tab === "data" && <DataTab projectId={projectId} />}
          {tab === "reports" && <ReportsTab projectId={projectId} />}
          {tab === "deliverables" && <DeliverablesTab projectId={projectId} project={project} />}
          {tab === "kpi" && <KpiTab projectId={projectId} />}
          {tab === "capacity" && <CapacityTab projectId={projectId} />}
          {tab === "evaluation" && <EvaluationTab projectId={projectId} />}
          {tab === "provider" && <ProviderTab projectId={projectId} project={project} />}
          {tab === "integrations" && <IntegrationsTab projectId={projectId} />}
          {tab === "members" && <ProjectMembersTab projectId={projectId} />}
          {tab === "activity" && <ActivityTab projectId={projectId} />}
        </>
      )}

      <TaskSheet />
    </>
  );
}
