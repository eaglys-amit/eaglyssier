import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";

import { NoAccess } from "@/components/shared/NoAccess";
import { useAccess } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { useProject } from "@/features/project-detail/ProjectShell";
import { PROJECT_SETTINGS } from "@/features/project-detail/settings-nav";
import {
  DEFAULT_TAB,
  isTabKey,
  PROJECT_TABS,
  tabCap,
  type TabKey,
} from "@/features/project-detail/tabs-nav";
import { CapacityTab } from "@/features/project-detail/tabs/CapacityTab";
import { DataTab } from "@/features/project-detail/tabs/DataTab";
import { DeliverablesTab } from "@/features/project-detail/tabs/DeliverablesTab";
import { DocumentsTab } from "@/features/project-detail/tabs/DocumentsTab";
import { GanttTab } from "@/features/project-detail/tabs/GanttTab";
import { MilestonesTab } from "@/features/project-detail/tabs/MilestonesTab";
import { PeopleTab } from "@/features/project-detail/tabs/PeopleTab";
import { RepoDocsTab } from "@/features/project-detail/tabs/RepoDocsTab";
import { ReportsTab } from "@/features/project-detail/tabs/ReportsTab";
import { ScrumsTab } from "@/features/project-detail/tabs/ScrumsTab";
import { SpecsTab } from "@/features/project-detail/tabs/SpecsTab";
import { SprintPlanningTab } from "@/features/project-detail/tabs/SprintPlanningTab";
import { TerminalTab } from "@/features/project-detail/tabs/TerminalTab";

const LEGACY_PEOPLE_TABS = ["kpi", "evaluation"] as const;

/**
 * The project's analysis views. The strip of tabs is the first thing in the
 * content column — the project itself is named in the sidebar — and each tab
 * opens with its own title bar (TabShell) below it.
 */
export function ProjectDetailLayout() {
  const { tab: tabParam } = useParams();
  const { projectId } = useProject();
  const navigate = useNavigate();
  const location = useLocation();

  // Legacy deep links used /projects/3#kpi; map them onto the tab URL scheme.
  // KPI and Evaluation were tabs of their own before People absorbed them:
  // /kpi?member=3 lands on that member's KPI section, and #kpi likewise.
  useEffect(() => {
    const hash = location.hash.replace("#", "");
    const legacy = LEGACY_PEOPLE_TABS.find((t) => t === tabParam || t === hash);
    if (legacy) {
      const search = new URLSearchParams(location.search);
      search.set("section", legacy);
      navigate(`/projects/${projectId}/people?${search}`, { replace: true });
      return;
    }
    const known = isTabKey(hash) || PROJECT_SETTINGS.some((s) => s.key === hash);
    if (hash && known) {
      navigate(`/projects/${projectId}/${hash}${location.search}`, { replace: true });
    } else if (!tabParam) {
      navigate(`/projects/${projectId}/${DEFAULT_TAB}${location.search}`, { replace: true });
    }
  }, [location.hash, location.search, navigate, projectId, tabParam]);

  const tab: TabKey = isTabKey(tabParam) ? tabParam : DEFAULT_TAB;
  const access = useAccess(projectId);
  const allowed = access.can(tabCap(tab));

  // Once the user starts a terminal session it stays mounted (hidden) across
  // tab switches so the PTY survives; it ends when they leave the project.
  const [terminalStarted, setTerminalStarted] = useState(false);

  return (
    // Full height of the scroll area so a tab can opt into fitting the screen
    // (the Data tab does, and scrolls inside its panels instead).
    <div className="flex h-full flex-col">
      {/* h-13 + border-b matches the sidebar header, so the two line up across
          the seam. Sticky: the strip stays put while a long tab scrolls. */}
      <nav className="sticky top-0 z-30 flex h-13 shrink-0 items-end gap-1 overflow-x-auto border-b bg-background px-6">
        {PROJECT_TABS.filter((t) => access.can(tabCap(t.key))).map((t) => (
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

      <div className="min-h-0 flex-1">
        {!allowed && <NoAccess />}
        {access.can("terminal") && (
          <div className={tab === "terminal" ? "block h-full" : "hidden"}>
            <TerminalTab
              projectId={projectId}
              started={terminalStarted}
              onStart={() => setTerminalStarted(true)}
              onEnd={() => setTerminalStarted(false)}
            />
          </div>
        )}
        {allowed && <>
        {tab === "data" && <DataTab projectId={projectId} />}
        {tab === "documents" && <DocumentsTab projectId={projectId} />}
        {tab === "specs" && <SpecsTab projectId={projectId} />}
        {tab === "scrums" && <ScrumsTab projectId={projectId} />}
        {/* Off the strip above — entered from the Scrums & Epics title bar. */}
        {tab === "sprint-planning" && <SprintPlanningTab projectId={projectId} />}
        {/* Also off the strip — entered per repository from the Data tab's
            Repositories panel, or reached bare for its repository picker. */}
        {tab === "repo-docs" && <RepoDocsTab projectId={projectId} />}
        {tab === "milestones" && <MilestonesTab projectId={projectId} />}
        {tab === "gantt" && <GanttTab projectId={projectId} />}
        {tab === "reports" && <ReportsTab projectId={projectId} />}
        {tab === "deliverables" && <DeliverablesTab projectId={projectId} />}
        {tab === "capacity" && <CapacityTab projectId={projectId} />}
        {tab === "people" && <PeopleTab projectId={projectId} />}
        </>}
      </div>
    </div>
  );
}
