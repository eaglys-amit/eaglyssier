import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { FolderX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "@/types/api";

import { CommitSheet } from "@/features/project-detail/CommitSheet";
import { TaskSheet } from "@/features/project-detail/TaskSheet";
import { PROJECT_SETTINGS } from "@/features/project-detail/settings-nav";
import { CapacityTab } from "@/features/project-detail/tabs/CapacityTab";
import { DataTab } from "@/features/project-detail/tabs/DataTab";
import { DeliverablesTab } from "@/features/project-detail/tabs/DeliverablesTab";
import { EvaluationTab } from "@/features/project-detail/tabs/EvaluationTab";
import { GanttTab } from "@/features/project-detail/tabs/GanttTab";
import { KpiTab } from "@/features/project-detail/tabs/KpiTab";
import { ReportsTab } from "@/features/project-detail/tabs/ReportsTab";
import { TerminalTab } from "@/features/project-detail/tabs/TerminalTab";

// Analysis views only. Project setup (provider, integrations, members,
// activity) lives on standalone pages linked from the title bar — see
// PROJECT_SETTINGS.
const TABS = [
  { key: "data", label: "Data" },
  { key: "gantt", label: "Gantt Chart" },
  { key: "reports", label: "Reports" },
  { key: "deliverables", label: "Deliverables" },
  { key: "kpi", label: "KPI" },
  { key: "capacity", label: "Capacity" },
  { key: "evaluation", label: "Evaluation" },
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
    const known =
      TABS.some((t) => t.key === hash) || PROJECT_SETTINGS.some((s) => s.key === hash);
    if (hash && known) {
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
    // Full height of the scroll area so a tab can opt into fitting the screen
    // (the Data tab does, and scrolls inside its panels instead).
    <div className="flex h-full flex-col">
      <PageHeader
        backTo="/projects"
        backLabel="Projects"
        title={project?.name ?? (isPending ? "…" : "")}
        badge={project?.key ? <Badge variant="secondary">{project.key}</Badge> : null}
        // Setup lives on its own pages, reached from here rather than from the
        // analysis tab strip.
        actions={PROJECT_SETTINGS.map((s) => (
          <Button key={s.key} asChild variant="ghost" size="sm">
            <Link to={`/projects/${projectId}/${s.key}`}>
              <s.icon className="size-4" />
              {s.label}
            </Link>
          </Button>
        ))}
      />

      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b px-6">
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

      {project?.description ? (
        <p className="shrink-0 px-6 pt-4 text-sm text-muted-foreground">{project.description}</p>
      ) : null}

      <div className="min-h-0 flex-1 p-6">
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
            {tab === "gantt" && <GanttTab projectId={projectId} />}
            {tab === "reports" && <ReportsTab projectId={projectId} />}
            {tab === "deliverables" && <DeliverablesTab projectId={projectId} project={project} />}
            {tab === "kpi" && <KpiTab projectId={projectId} />}
            {tab === "capacity" && <CapacityTab projectId={projectId} />}
            {tab === "evaluation" && <EvaluationTab projectId={projectId} />}
          </>
        )}
      </div>

      <TaskSheet />
      <CommitSheet />
    </div>
  );
}
