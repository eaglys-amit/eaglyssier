import {
  BookText,
  ClipboardList,
  FileCheck2,
  Database,
  FileText,
  Flag,
  GanttChartSquare,
  Gauge,
  Package,
  ScrollText,
  Spade,
  SquareTerminal,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Cap } from "@/lib/permissions";

/**
 * The project's analysis views — the tab strip at the top of the content column
 * and the title bar each tab opens with (see TabShell) read from this one list,
 * so a tab's label, icon, and one-line intro can't drift between the two.
 *
 * Project setup (provider, integrations, members, activity) is not here: those
 * live in the sidebar, driven by PROJECT_SETTINGS.
 */
export const PROJECT_TABS = [
  {
    key: "data",
    label: "Data",
    icon: Database,
    blurb: "Sprints, tasks, and repositories synced from the connected platforms.",
  },
  // The other half of the project's input: what Data syncs from the platforms,
  // this holds what a human uploaded. Both come before the views that read them.
  {
    key: "documents",
    label: "Documents",
    icon: FileText,
    blurb: "Specs, notes and exports the work came from, with the text extracted from each.",
  },
  // Documents promoted to tracked specs: each requirement traced to its work.
  {
    key: "specs",
    label: "Specs",
    icon: FileCheck2,
    blurb: "Requirements from your specs, traced to the tasks and commits that implement them.",
  },
  // The write surface over the same sprints/tasks Data reads, so it sits next to it.
  {
    key: "scrums",
    label: "Scrums & Epics",
    icon: ClipboardList,
    blurb: "Plan the sprint: the backlog board, epic structure, and charts.",
  },
  // The layer above the sprint horizon, rolled up from the same tasks.
  {
    key: "milestones",
    label: "Milestones",
    icon: Flag,
    blurb: "Delivery targets above the sprint horizon, rolled up from linked tasks.",
  },
  {
    key: "gantt",
    label: "Gantt Chart",
    icon: GanttChartSquare,
    blurb: "Task timeline across sprints, with commits attributed to the tasks they touch.",
  },
  {
    key: "reports",
    label: "Reports",
    icon: ScrollText,
    blurb: "Generated write-ups of the project's progress, ready to share.",
  },
  {
    key: "deliverables",
    label: "Deliverables",
    icon: Package,
    blurb: "What the project has shipped, inferred from completed tasks and repository work.",
  },
  // Per-person: the data scope a member's KPI and evaluation are generated
  // from, the KPI itself, and the evaluation sheet (replaces the KPI and
  // Evaluation tabs; ?section= picks which).
  {
    key: "people",
    label: "People",
    icon: Users,
    blurb: "Each member's data scope, KPI and evaluation sheet, in one place.",
    cap: "people",
  },
  {
    key: "capacity",
    label: "Capacity",
    icon: Gauge,
    blurb: "Sprint capacity and the story-point scale estimates are measured against.",
  },
  {
    key: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    blurb: "A shell session scoped to this project, running through the analysis provider.",
    cap: "terminal",
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  /** Capability needed to see the tab (default: "view"). */
  cap?: Cap;
}>;

/**
 * Pages that reuse the tab frame but are NOT in the strip — each is entered from
 * another tab's title bar rather than from the strip itself.
 *
 * Sprint Planning is one workflow you enter from Scrums & Epics, not a twelfth
 * peer of "Terminal": the strip already scrolls at eleven, and estimating is
 * something you go and do, not a view you glance at.
 *
 * Repository Docs is off the strip for a different reason: it is scoped to one
 * repository rather than to the project, so a tab of its own would really have
 * to be a tab per repository. It is entered per repo from the Repositories
 * panel on the Data tab and carries the repo in `?repo=`.
 */
export const OFF_STRIP_TABS = [
  {
    key: "sprint-planning",
    label: "Sprint Planning",
    icon: Spade,
    blurb:
      "Break work down with AI, estimate it with planning poker, and export what the sprint agreed.",
  },
  {
    key: "repo-docs",
    label: "Repository Docs",
    icon: BookText,
    blurb:
      "AI-written documentation for one repository: a folder tree of documents you can generate, edit and export.",
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  /** Capability needed to see the tab (default: "view"). */
  cap?: Cap;
}>;

/**
 * Every page TabShell can frame. PROJECT_TABS is the strip; this is the strip
 * plus the pages reached from a title bar, so routing and TabShell resolve a key
 * the strip deliberately doesn't show.
 */
export const ALL_TABS = [...PROJECT_TABS, ...OFF_STRIP_TABS];

export type TabKey = (typeof ALL_TABS)[number]["key"];

export const DEFAULT_TAB: TabKey = "data";

/** The capability a tab needs; everything not marked is readable by any member. */
export function tabCap(key: TabKey): Cap {
  const tab = ALL_TABS.find((t) => t.key === key);
  return tab && "cap" in tab ? tab.cap : "view";
}

export function isTabKey(value: string | undefined): value is TabKey {
  return ALL_TABS.some((t) => t.key === value);
}
