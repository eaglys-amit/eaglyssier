import { ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { TabShell } from "@/features/project-detail/TabShell";

import { BreakdownPanel } from "./scrums/BreakdownPanel";
import { PokerView } from "./scrums/PokerView";
import { PLANNING_VIEWS, usePlanningParams, type PlanningView } from "./sprint-planning-nav";

/**
 * Where a sprint's work gets made and measured: AI breaks a document down into a
 * task tree, and planning poker puts an agreed number on each one.
 *
 * Off the tab strip on purpose — this is somewhere you go from Scrums & Epics for
 * the length of a refinement session, not a view you glance at. It reuses TabShell
 * so the title bar, spacing and full-height contract match every other page.
 */
export function SprintPlanningTab({ projectId }: { projectId: number }) {
  const { view, sprintId, setView } = usePlanningParams();

  return (
    <TabShell
      tab="sprint-planning"
      actions={
        // A button rather than PageHeader's `backTo`, which would suppress the
        // page's description line — and this way the trip out and the trip back
        // look like each other.
        <Button asChild size="sm" variant="outline">
          <Link to={`/projects/${projectId}/scrums${sprintId ? `?sprint=${sprintId}` : ""}`}>
            <ClipboardList className="size-4" /> Scrums &amp; Epics
          </Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-4 lg:h-full">
        <div className="shrink-0">
          <Tabs value={view} onValueChange={(v) => setView(v as PlanningView)}>
            <TabsList variant="line">
              {PLANNING_VIEWS.map((v) => (
                <TabsTrigger key={v.key} value={v.key}>
                  <v.icon className="size-3.5" />
                  {v.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {view === "poker" ? (
          <PokerView projectId={projectId} sprintId={sprintId} />
        ) : (
          // The panel is the whole view — it owns its own inputs, job state and
          // draft editor, so there is nothing to wrap it in.
          <BreakdownPanel projectId={projectId} sprintId={sprintId} />
        )}
      </div>
    </TabShell>
  );
}
