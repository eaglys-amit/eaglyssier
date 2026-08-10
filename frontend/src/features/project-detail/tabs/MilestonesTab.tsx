import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { TabShell } from "@/features/project-detail/TabShell";

import { MilestoneListView } from "./milestones/MilestoneListView";
import { MilestoneSheet } from "./milestones/MilestoneSheet";
import { MILESTONE_VIEWS, type MilestoneView } from "./milestones/milestone-nav";
import { RoadmapView } from "./milestones/RoadmapView";
import { useMilestoneParams } from "./milestones/useMilestoneParams";
import { useMilestones } from "./milestones/useMilestones";

/**
 * Milestones: the layer above the sprint horizon.
 *
 * A milestone stores a name and two dates and nothing else. Progress, the
 * sprints it spans and the completion forecast are all rolled up server-side
 * from the tasks linked to it — the same tasks the Scrums board moves around,
 * and the same velocity behind the Scrums charts. Nothing here is a second
 * copy of anything.
 *
 * Sub-views live in `?view=` rather than in separate tabs, as in ScrumsTab: the
 * project strip is already long, and a roadmap and a list of the same rows are
 * one workflow. Tabs is used purely as a URL-controlled segmented control.
 */
export function MilestonesTab({ projectId }: { projectId: number }) {
  const { view, setView, setMilestoneId } = useMilestoneParams();
  // One query, shared: the sheet reads the row the list already has, so opening
  // it costs nothing and both always show the same numbers.
  const { milestones } = useMilestones(projectId);

  return (
    <TabShell tab="milestones">
      <div className="flex flex-col gap-4">
        <div className="shrink-0">
          <Tabs value={view} onValueChange={(v) => setView(v as MilestoneView)}>
            <TabsList variant="line">
              {MILESTONE_VIEWS.map((v) => (
                <TabsTrigger key={v.key} value={v.key}>
                  <v.icon className="size-3.5" />
                  {v.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {view === "roadmap" ? (
          <RoadmapView projectId={projectId} onOpenMilestone={setMilestoneId} />
        ) : (
          <MilestoneListView projectId={projectId} onOpenMilestone={setMilestoneId} />
        )}

        <MilestoneSheet projectId={projectId} milestones={milestones} />
      </div>
    </TabShell>
  );
}
