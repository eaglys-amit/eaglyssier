import { Spade } from "lucide-react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { TabShell } from "@/features/project-detail/TabShell";

import { BoardView } from "./scrums/BoardView";
import { ChartsView } from "./scrums/ChartsView";
import { EpicsView } from "./scrums/EpicsView";
import { SCRUM_VIEWS, type ScrumView } from "./scrums/scrum-nav";
import { useScrumParams } from "./scrums/useScrumParams";

/**
 * The write surface over the same sprints and tasks the Data tab reads: where the
 * backlog is planned into sprints, and where the epic structure over those tasks
 * lives.
 *
 * Sub-views live in `?view=` rather than in separate tabs — the strip at the top
 * of the project is already eleven items wide, and these are one workflow, not
 * peers of "Terminal". The Tabs primitive is used purely as a URL-controlled
 * segmented control (no TabsContent), the way ReposSection uses it for its view
 * switch.
 *
 * Estimating is the other half of planning and is a page of its own — see
 * SprintPlanningTab, reached from the button in this tab's title bar.
 */
export function ScrumsTab({ projectId }: { projectId: number }) {
  const { view, sprintId, setView, setSprintId } = useScrumParams();

  return (
    <TabShell
      tab="scrums"
      actions={
        <Button asChild size="sm" variant="outline">
          {/* Carries ?sprint= across so the sprint you were planning is the one
              being estimated — both pages read the param the same way. */}
          <Link
            to={`/projects/${projectId}/sprint-planning${sprintId ? `?sprint=${sprintId}` : ""}`}
          >
            <Spade className="size-4" /> Sprint Planning
          </Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-4 lg:h-full">
        <div className="shrink-0">
          <Tabs value={view} onValueChange={(v) => setView(v as ScrumView)}>
            <TabsList variant="line">
              {SCRUM_VIEWS.map((v) => (
                <TabsTrigger key={v.key} value={v.key}>
                  <v.icon className="size-3.5" />
                  {v.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {view === "board" ? (
          <BoardView
            projectId={projectId}
            sprintId={sprintId}
            onSelectSprint={setSprintId}
            onOpenEpics={() => setView("epics")}
          />
        ) : view === "epics" ? (
          // Whole-project structure, so it takes no sprint — unlike every other
          // view here, which is scoped by ?sprint=.
          <EpicsView projectId={projectId} />
        ) : view === "charts" ? (
          <ChartsView projectId={projectId} sprintId={sprintId} onSelectSprint={setSprintId} />
        ) : (
          <NotYet view={view} />
        )}
      </div>
    </TabShell>
  );
}

function NotYet({ view }: { view: ScrumView }) {
  const meta = SCRUM_VIEWS.find((v) => v.key === view)!;
  return (
    <EmptyState
      icon={meta.icon}
      title={`${meta.label} is not built yet`}
      hint="Standup and retro notes are coming in a later phase."
    />
  );
}
