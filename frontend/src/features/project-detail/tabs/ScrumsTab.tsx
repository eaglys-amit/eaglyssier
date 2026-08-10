import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { TabShell } from "@/features/project-detail/TabShell";

import { BoardView } from "./scrums/BoardView";
import { BreakdownPanel } from "./scrums/BreakdownPanel";
import { ChartsView } from "./scrums/ChartsView";
import { PokerView } from "./scrums/PokerView";
import { SCRUM_VIEWS, type ScrumView } from "./scrums/scrum-nav";
import { useScrumParams } from "./scrums/useScrumParams";

/**
 * Sprint planning: the write surface over the same sprints and tasks the Data
 * tab reads.
 *
 * Sub-views live in `?view=` rather than in separate tabs — the strip at the top
 * of the project is already eight items wide, and these five are one workflow,
 * not five peers of "Terminal". The Tabs primitive is used purely as a
 * URL-controlled segmented control (no TabsContent), the way ReposSection uses
 * it for its view switch.
 */
export function ScrumsTab({ projectId }: { projectId: number }) {
  const { view, sprintId, setView, setSprintId } = useScrumParams();

  return (
    <TabShell tab="scrums">
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
          <BoardView projectId={projectId} sprintId={sprintId} onSelectSprint={setSprintId} />
        ) : view === "poker" ? (
          <PokerView projectId={projectId} sprintId={sprintId} />
        ) : view === "ai" ? (
          // The panel is the whole view — it owns its own inputs, job state and
          // draft editor, so there is nothing to wrap it in.
          <BreakdownPanel projectId={projectId} sprintId={sprintId} />
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
