import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { TabShell } from "@/features/project-detail/TabShell";
import { ReposSection } from "@/features/project-detail/tabs/data/ReposSection";
import { ScopeBar } from "@/features/project-detail/tabs/data/ScopeBar";
import { SprintsSection } from "@/features/project-detail/tabs/data/SprintsSection";
import { useMemberScope } from "@/features/project-detail/tabs/data/useAnalysisScope";

type Side = "left" | "right";

export function DataTab({ projectId }: { projectId: number }) {
  const [params, setParams] = useSearchParams();

  const activeMemberId = Number(params.get("member")) || null;
  const { scope, update, toggleSprint, toggleRepo, reset } = useMemberScope(
    projectId,
    activeMemberId,
  );

  const selectMember = (id: number | null) => {
    if (id == null) params.delete("member");
    else params.set("member", String(id));
    setParams(params, { replace: true });
  };

  // Sprints take 40% and repositories 60% by default — the repo tables (sha,
  // message, author, diff, analysis) need the extra room. Either panel can take
  // the rest of the row, narrowing the other to a header-only strip.
  const [wide, setWide] = useState<Side | null>(null);

  // That split only exists in the side-by-side layout. When the panels stack,
  // drop it — otherwise one of them stays narrowed with nothing to restore it.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const apply = () => {
      if (!mq.matches) setWide(null);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const pane = (side: Side, basis: string) => {
    if (wide === null) return cn("min-w-0 lg:h-full lg:grow lg:shrink", basis);
    return wide === side
      ? "min-w-0 lg:h-full lg:grow lg:shrink"
      : "min-w-0 lg:h-full lg:w-11 lg:shrink-0 lg:grow-0";
  };

  const widthAction = (side: Side) => {
    const isWide = wide === side;
    // The icon names the panel being closed, not this one: from the left panel
    // you close the right, and vice versa.
    const Icon =
      side === "left"
        ? isWide
          ? PanelRightOpen
          : PanelRightClose
        : isWide
          ? PanelLeftOpen
          : PanelLeftClose;
    const label = isWide ? "Restore the split" : "Give this panel the full width";
    return (
      <Button
        variant="ghost"
        size="icon"
        className="hidden size-7 lg:inline-flex"
        title={label}
        onClick={() => setWide(isWide ? null : side)}
      >
        <Icon className="size-4" />
        <span className="sr-only">{label}</span>
      </Button>
    );
  };

  return (
    <TabShell tab="data">
      {/* Fits the screen from lg up: the panels scroll internally, the page
          doesn't. Narrower than that they stack and the page scrolls as usual. */}
      <div className="flex flex-col gap-6 lg:h-full">
        {/* Row 1: member filter — common control bar for both Jira and repositories. */}
        <div className="shrink-0">
          <ScopeBar
            projectId={projectId}
            activeMemberId={activeMemberId}
            onSelectMember={selectMember}
            scope={scope}
            onUpdate={update}
            onReset={reset}
          />
        </div>
        {/* Row 2: the two data domains, side by side. Each carries the sync
            controls for the integrations that feed it. */}
        <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-start">
          <div className={cn("transition-[flex-basis,width]", pane("left", "lg:basis-2/5"))}>
            <SprintsSection
              projectId={projectId}
              activeMemberId={activeMemberId}
              scope={scope}
              onToggleSprint={toggleSprint}
              collapsed={wide === "right"}
              widthAction={widthAction("left")}
            />
          </div>
          <div className={cn("transition-[flex-basis,width]", pane("right", "lg:basis-3/5"))}>
            <ReposSection
              projectId={projectId}
              activeMemberId={activeMemberId}
              scope={scope}
              onToggleRepo={toggleRepo}
              collapsed={wide === "left"}
              widthAction={widthAction("right")}
            />
          </div>
        </div>
      </div>
    </TabShell>
  );
}
