import {
  BarChart3,
  ClipboardList,
  Database,
  FileText,
  Flag,
  GanttChartSquare,
  Gauge,
  Package,
  ScrollText,
  SquareTerminal,
  Star,
  type LucideIcon,
} from "lucide-react";

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
  // The write surface over the same sprints/tasks Data reads, so it sits next to it.
  {
    key: "scrums",
    label: "Scrums",
    icon: ClipboardList,
    blurb: "Plan the sprint: board, planning poker, AI breakdown, and charts.",
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
  {
    key: "kpi",
    label: "KPI",
    icon: BarChart3,
    blurb: "Per-member performance ratings drawn from their tasks and commits.",
  },
  {
    key: "capacity",
    label: "Capacity",
    icon: Gauge,
    blurb: "Sprint capacity and the story-point scale estimates are measured against.",
  },
  {
    key: "evaluation",
    label: "Evaluation",
    icon: Star,
    blurb: "The evaluation sheet for each member, scored and kept with the project.",
  },
  {
    key: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    blurb: "A shell session scoped to this project, running through the analysis provider.",
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
}>;

export type TabKey = (typeof PROJECT_TABS)[number]["key"];

export const DEFAULT_TAB: TabKey = "data";

export function isTabKey(value: string | undefined): value is TabKey {
  return PROJECT_TABS.some((t) => t.key === value);
}
