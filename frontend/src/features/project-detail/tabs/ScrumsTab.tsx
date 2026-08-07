import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BoardView } from "./scrums/BoardView";
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
      ) : (
        <NotYet view={view} />
      )}
    </div>
  );
}

function NotYet({ view }: { view: ScrumView }) {
  const meta = SCRUM_VIEWS.find((v) => v.key === view)!;
  return (
    <EmptyState
      icon={meta.icon}
      title={`${meta.label} is not built yet`}
      hint="Planning poker, reference documents with AI breakdown, burndown and velocity charts, and standup/retro notes are coming in later phases."
    />
  );
}
