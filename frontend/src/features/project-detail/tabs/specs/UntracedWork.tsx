import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatPoints } from "@/lib/format";

import { useUntraced } from "./useSpecs";

/**
 * Recent work (active, upcoming and last closed sprint) that implements no
 * tracked requirement — scope that arrived without a spec. Open a task to link
 * it to a requirement from its sheet, or leave it if it's genuinely spec-free
 * (chores, fixes).
 */
export function UntracedWork({ projectId }: { projectId: number }) {
  const { data: rows } = useUntraced(projectId);
  if (!rows?.length) return null;
  const points = rows.reduce((n, r) => n + (r.story_points ?? 0), 0);

  return (
    <Collapsible>
      <Card>
        <CardContent className="p-0">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm">
            <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
            <span className="font-medium">Untraced work</span>
            <span className="text-xs text-muted-foreground">
              {rows.length} task{rows.length === 1 ? "" : "s"} · {formatPoints(points)} pts in recent sprints
              implement no tracked requirement
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y border-t">
              {rows.map((r) => (
                <li key={r.task_id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                  <Link to={`?task=${r.task_id}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.key}</span>
                    <span className="truncate">{r.title}</span>
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.sprint_name}</span>
                  <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums">
                    {r.story_points ?? "—"}
                  </span>
                  {taskCategoryBadge(r.status_category)}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
