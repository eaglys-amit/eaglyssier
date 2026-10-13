import { Check, FileCheck2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccess } from "@/lib/permissions";
import type { TaskDetail } from "@/types/api";

import { requirementStatusBadge } from "@/features/project-detail/tabs/specs/spec-ui";
import {
  useProjectRequirements,
  useSpecMutations,
  useTaskRequirements,
} from "@/features/project-detail/tabs/specs/useSpecs";

/** The task sheet's "which requirements does this implement" section. */
export function TaskRequirements({ task }: { task: TaskDetail }) {
  const projectId = task.project_id;
  const canLink = useAccess(projectId).can("task");
  const { data: linked = [] } = useTaskRequirements(task.id);
  const { data: all = [] } = useProjectRequirements(projectId, canLink);
  const m = useSpecMutations(projectId);
  const [pick, setPick] = useState("");

  // Nothing tracked in this project and nothing linked: keep the sheet quiet.
  if (!linked.length && !all.length) return null;

  const linkedIds = new Set(linked.map((r) => r.requirement_id));
  const options = all.filter((r) => !linkedIds.has(r.id));
  const bySpec = new Map<string, typeof options>();
  for (const r of options) bySpec.set(r.spec_title, [...(bySpec.get(r.spec_title) ?? []), r]);

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Requirements ({linked.length})
      </div>
      {linked.length ? (
        <ul className="mb-2 divide-y rounded-md border">
          {linked.map((r) => (
            <li key={r.requirement_id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <FileCheck2 className="size-3.5 shrink-0 text-muted-foreground" />
              <Link
                to={`/projects/${projectId}/specs?spec=${r.spec_id}`}
                className="min-w-0 flex-1 truncate hover:underline"
                title={`${r.spec_title}: ${r.title}`}
              >
                <span className="font-mono text-xs text-muted-foreground">{r.key}</span> {r.title}
              </Link>
              {requirementStatusBadge(r.status)}
              {r.needs_review && canLink ? (
                <Button size="icon" variant="ghost" className="size-7 text-warning"
                        title="The requirement changed since this link was made — click once you've checked the task still fits"
                        onClick={() => m.reviewed.mutate({ requirementId: r.requirement_id, taskId: task.id })}>
                  <Check className="size-3.5" />
                </Button>
              ) : r.needs_review ? (
                <span className="text-xs text-warning">Review</span>
              ) : null}
              {canLink ? (
                <Button size="icon" variant="ghost" className="size-7 text-muted-foreground"
                        onClick={() => m.unlink.mutate({ requirementId: r.requirement_id, taskId: task.id })}>
                  <X className="size-3.5" />
                  <span className="sr-only">Unlink</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canLink && options.length ? (
        <Select
          value={pick}
          onValueChange={(v) => {
            setPick("");
            m.link.mutate({ requirementId: Number(v), taskId: task.id });
          }}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Link to a requirement…" />
          </SelectTrigger>
          <SelectContent>
            {[...bySpec.entries()].map(([spec, reqs]) => (
              <SelectGroup key={spec}>
                <SelectLabel>{spec}</SelectLabel>
                {reqs.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    <span className="font-mono text-xs text-muted-foreground">{r.key}</span> {r.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
