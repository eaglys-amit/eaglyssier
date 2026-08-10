import { ArrowLeft, ScanSearch } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { BrandLink } from "@/components/layout/BrandLink";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "@/types/api";

import { PROJECT_SETTINGS } from "@/features/project-detail/settings-nav";
import { DEFAULT_TAB } from "@/features/project-detail/tabs-nav";

const ITEM_CLASS =
  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors";
const ACTIVE_CLASS = "bg-sidebar-accent text-sidebar-accent-foreground";
const IDLE_CLASS =
  "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground";

/**
 * The sidebar a project brings with it: who you are looking at, the analysis
 * views, and the setup behind them.
 *
 * Analyzer is one item rather than ten because its ten views are the tab strip
 * in the content column; the sidebar only has to get you back into them from a
 * setup section. The setup sections, by contrast, are things you configure once
 * and return to, not views you flip between while reading a report.
 */
export function ProjectSidebar({
  projectId,
  project,
}: {
  projectId: number;
  project: ProjectDetail | undefined;
}) {
  // Analyzer covers every tab, so it can't lean on NavLink's exact-path match:
  // it is active whenever the URL isn't one of the setup sections.
  const section = useLocation().pathname.split("/")[3] ?? "";
  const analyzerActive = !PROJECT_SETTINGS.some((s) => s.key === section);

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      {/* h-19 + border-b matches the tab strip, so the two line up across the seam. */}
      <div className="flex h-19 shrink-0 items-center border-b px-4">
        <BrandLink />
      </div>

      {/* Which project everything below belongs to. The arrow is the way back
          out to the list, since the mark above goes home instead. */}
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight">
            {project?.name ?? "…"}
          </span>
          {project?.key ? (
            <Badge variant="secondary" className="shrink-0">
              {project.key}
            </Badge>
          ) : null}
        </div>
        <Link
          to="/projects"
          title="All projects"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        >
          <ArrowLeft className="size-4" />
          <span className="sr-only">All projects</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-6 px-3 py-2">
        <div>
          <div className="px-2 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Analysis
          </div>
          <ul className="space-y-0.5">
            <li>
              <Link
                to={`/projects/${projectId}/${DEFAULT_TAB}`}
                className={cn(ITEM_CLASS, analyzerActive ? ACTIVE_CLASS : IDLE_CLASS)}
              >
                <ScanSearch className="size-4" />
                Analyzer
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <div className="px-2 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Setup
          </div>
          <ul className="space-y-0.5">
            {PROJECT_SETTINGS.map((s) => (
              <li key={s.key}>
                <NavLink
                  to={`/projects/${projectId}/${s.key}`}
                  className={({ isActive }) =>
                    cn(ITEM_CLASS, isActive ? ACTIVE_CLASS : IDLE_CLASS)
                  }
                >
                  <s.icon className="size-4" />
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="flex items-center justify-between border-t px-4 py-3">
        <span className="text-xs text-muted-foreground">Theme</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
