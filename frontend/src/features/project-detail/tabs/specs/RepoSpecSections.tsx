import { ChevronRight, CircleCheck, Circle } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { taskCategoryBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SpecDetail } from "@/types/api";

/** tasks.md, line by line, with the tracker task each line matched. */
export function RepoTasksSection({ spec }: { spec: SpecDetail }) {
  const [, setParams] = useSearchParams();
  if (!spec.repo_tasks.length) return null;
  const matched = spec.repo_tasks.filter((t) => t.task_id).length;
  const openTask = (id: number) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("task", String(id));
      return next;
    });

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold tracking-tight">tasks.md</h3>
        <span className="text-xs text-muted-foreground">
          {matched} of {spec.repo_tasks.length} lines matched to a task
        </span>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Line</TableHead>
                <TableHead>Task in tasks.md</TableHead>
                <TableHead className="w-28">For</TableHead>
                <TableHead className="w-64">Matched task</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {spec.repo_tasks.map((t) => {
                // Ticked in the repo but still open in the tracker (or the reverse):
                // worth a glance, since the two are meant to agree.
                const disagree =
                  t.task_status_category !== null &&
                  t.done !== (t.task_status_category === "done");
                return (
                  <TableRow key={t.key} className="align-top">
                    <TableCell className="font-mono text-xs">
                      <span className="inline-flex items-center gap-1">
                        {t.done ? (
                          <CircleCheck className="size-3.5 text-success" aria-label="ticked" />
                        ) : (
                          <Circle className="size-3.5 text-muted-foreground" aria-label="open" />
                        )}
                        {t.key}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.text}
                      {t.parallel ? <span className="ml-1 text-[10px] text-muted-foreground">[P]</span> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {[t.story, ...t.requirement_keys].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.task_id ? (
                        <div className="space-y-1">
                          <button type="button" className="flex max-w-full items-center gap-1.5 text-left hover:underline"
                                  onClick={() => openTask(t.task_id!)}>
                            <span className="font-mono text-muted-foreground">{t.task_key}</span>
                            <span className="truncate">{t.task_title}</span>
                          </button>
                          <div className="flex items-center gap-1.5">
                            {t.task_status_category ? taskCategoryBadge(t.task_status_category) : null}
                            <span className="text-muted-foreground">by {t.match === "key" ? "id" : "title"}</span>
                          </div>
                          {disagree ? (
                            <div className="text-warning">
                              {t.done ? "Ticked in tasks.md, open in the tracker" : "Done in the tracker, unticked in tasks.md"}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No matching task</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

/** plan.md as written: context for reviewers, not tracked. */
export function PlanSection({ spec }: { spec: SpecDetail }) {
  if (!spec.plan_markdown) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-semibold tracking-tight">
        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
        plan.md
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
          {spec.plan_markdown}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
