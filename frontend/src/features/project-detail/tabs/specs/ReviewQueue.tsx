import { Check, X } from "lucide-react";
import { Link } from "react-router-dom";

import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccess } from "@/lib/permissions";

import { changeBadge } from "./spec-ui";
import { useSpecMutations, useSpecReview } from "./useSpecs";

/**
 * Work linked to a requirement that has since changed or been removed. Each row
 * asks one question — does this task still match what the spec now says? —
 * answered with "Still fits" or by unlinking it.
 */
export function ReviewQueue({ projectId }: { projectId: number }) {
  const { data: items } = useSpecReview(projectId);
  const canLink = useAccess(projectId).can("task");
  const m = useSpecMutations(projectId);
  if (!items?.length) return null;

  return (
    <Card className="border-warning/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Needs review ({items.length})</CardTitle>
        <CardDescription>
          These tasks were linked before their requirement changed. Check each still matches the spec.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y border-t">
          {items.map((i) => (
            <li key={`${i.requirement_id}-${i.task_id}`} className="flex flex-wrap items-start gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link to={`?spec=${i.spec_id}`} className="font-mono text-xs text-muted-foreground hover:underline">
                    {i.spec_title} · {i.key}
                  </Link>
                  {changeBadge(i.change_state, i.changed_in_version)}
                </div>
                <div className="font-medium">{i.title}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{i.statement}</div>
              </div>
              <div className="w-64 space-y-1">
                <Link to={`?task=${i.task_id}`} className="flex items-center gap-1.5 hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{i.task_key}</span>
                  <span className="truncate">{i.task_title}</span>
                </Link>
                {taskCategoryBadge(i.task_status_category)}
              </div>
              {canLink ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={m.reviewed.isPending}
                          onClick={() => m.reviewed.mutate({ requirementId: i.requirement_id, taskId: i.task_id })}>
                    <Check className="size-3.5" /> Still fits
                  </Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={m.unlink.isPending}
                          onClick={() => m.unlink.mutate({ requirementId: i.requirement_id, taskId: i.task_id })}>
                    <X className="size-3.5" /> Unlink
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
