import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDateTime } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Requirement, RequirementAiCheck } from "@/types/api";

import { useSpecMutations } from "./useSpecs";

const VERDICT: Record<RequirementAiCheck["criteria"][number]["verdict"], { label: string; cls: string }> = {
  met: { label: "AI: met", cls: "border-success/40 bg-success/10 text-success" },
  partial: { label: "AI: partial", cls: "border-warning/40 bg-warning/10 text-warning" },
  not_evident: { label: "AI: not evident", cls: "border-border text-muted-foreground" },
};

function Verdict({ verdict, evidence }: { verdict: keyof typeof VERDICT; evidence: string }) {
  return (
    <div className="mt-1 flex items-start gap-1.5 text-xs">
      <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium", VERDICT[verdict].cls)}>
        {VERDICT[verdict].label}
      </span>
      {evidence ? <span className="text-muted-foreground">{evidence}</span> : null}
    </div>
  );
}

/**
 * Acceptance criteria with their verification. People with the right tick
 * each one; the AI check, when run, sits under each criterion as a suggestion
 * with its evidence — it never ticks anything.
 */
export function AcceptanceCriteria({ projectId, specId, requirement: r }: {
  projectId: number;
  specId: number;
  requirement: Requirement;
}) {
  const canVerify = useAccess(projectId).can("verify");
  const m = useSpecMutations(projectId, specId);
  const check = r.ai_check;
  const checkFor = (text: string) => check?.criteria.find((c) => c.text === text);
  const running = r.ai_check_status === "running";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Acceptance criteria
          {r.acceptance_criteria.length
            ? ` · ${r.acceptance_criteria.filter((c) => c.verified).length}/${r.acceptance_criteria.length} verified`
            : ""}
        </span>
        {canVerify && r.status !== "removed" ? (
          <Button size="xs" variant="outline" disabled={running || !r.tasks.length || m.aiCheck.isPending}
                  title={r.tasks.length ? "Ask the AI whether the linked tasks and commits show each criterion delivered"
                                        : "Link the implementing tasks first"}
                  onClick={() => m.aiCheck.mutate(r.id)}>
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {running ? "Checking…" : check ? "Re-check with AI" : "Check with AI"}
          </Button>
        ) : null}
      </div>

      {r.acceptance_criteria.length ? (
        <ul className="space-y-2">
          {r.acceptance_criteria.map((c, i) => {
            const ai = checkFor(c.text);
            return (
              <li key={i} className="flex items-start gap-2">
                <Checkbox
                  className="mt-0.5"
                  checked={c.verified}
                  disabled={!canVerify || m.setCriterion.isPending}
                  onCheckedChange={(v) =>
                    m.setCriterion.mutate({ requirementId: r.id, index: i, text: c.text, verified: v === true })
                  }
                  aria-label={`Verified: ${c.text}`}
                />
                <div className="min-w-0 flex-1">
                  <div className={cn(c.verified && "text-muted-foreground")}>{c.text}</div>
                  {c.verified && c.verified_by ? (
                    <div className="text-[11px] text-muted-foreground">
                      Verified by {c.verified_by}{c.verified_at ? ` · ${formatDateTime(c.verified_at)}` : ""}
                    </div>
                  ) : null}
                  {ai ? <Verdict verdict={ai.verdict} evidence={ai.evidence} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <p className="text-muted-foreground">
            None given in the spec{canVerify ? " — add some by editing the requirement so it can be verified" : ""}.
          </p>
          {check?.from_statement && check.criteria[0] ? (
            <Verdict verdict={check.criteria[0].verdict} evidence={check.criteria[0].evidence} />
          ) : null}
        </>
      )}

      {r.ai_check_status === "failed" && r.ai_check_error ? (
        <p className="mt-2 text-xs text-destructive">AI check failed: {r.ai_check_error}</p>
      ) : check ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {check.summary}
          {check.checked_at ? ` · checked ${formatDateTime(check.checked_at)}` : ""}
          {check.model ? ` via ${check.model}` : ""}. A suggestion from tasks and commit summaries — tick
          what you've confirmed.
        </p>
      ) : null}
    </div>
  );
}
