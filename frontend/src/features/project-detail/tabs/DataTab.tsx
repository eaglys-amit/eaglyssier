import { CalendarRange, FolderGit2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { TabShell } from "@/features/project-detail/TabShell";
import {
  PersonFilter,
  UnmappedAccountsHint,
} from "@/features/project-detail/tabs/data/PersonFilter";
import { ReposSection } from "@/features/project-detail/tabs/data/ReposSection";
import { SprintsSection } from "@/features/project-detail/tabs/data/SprintsSection";

type DataView = "tracker" | "repos";

/**
 * What the integrations synced, one source at a time: the tracker's sprints
 * and tasks, or the repositories' summaries, commits and PRs. Each view gets
 * the full width and carries the sync controls for the sources that feed it.
 */
export function DataTab({ projectId }: { projectId: number }) {
  const [params, setParams] = useSearchParams();
  const view: DataView = params.get("view") === "repos" ? "repos" : "tracker";
  const personId = Number(params.get("person")) || null;

  const set = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  // Both controls live in the tab's title bar: they apply to everything below,
  // and the content gets the whole column.
  const actions = (
    <div className="flex items-center gap-2">
      <PersonFilter
        projectId={projectId}
        personId={personId}
        onChange={(id) => set("person", id === null ? null : String(id))}
      />
      <Tabs value={view} onValueChange={(v) => set("view", v === "tracker" ? null : v)}>
        <TabsList>
          <TabsTrigger value="tracker">
            <CalendarRange className="size-3.5" /> Tracker
          </TabsTrigger>
          <TabsTrigger value="repos">
            <FolderGit2 className="size-3.5" /> Repositories
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );

  return (
    <TabShell tab="data" actions={actions}>
      {/* Fits the screen from lg up: the list scrolls inside its panel. */}
      <div className="flex flex-col gap-4 lg:h-full">
        <UnmappedAccountsHint projectId={projectId} personId={personId} />
        <div className="lg:min-h-0 lg:flex-1">
          {view === "tracker" ? (
            <SprintsSection projectId={projectId} personId={personId} />
          ) : (
            <ReposSection projectId={projectId} personId={personId} />
          )}
        </div>
      </div>
    </TabShell>
  );
}
