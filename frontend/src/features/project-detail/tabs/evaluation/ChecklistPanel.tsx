import { CheckCircle2, XCircle } from "lucide-react";

import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Checklist } from "@/types/api";

import { CHECKLIST_GROUPS } from "./constants";

export function ChecklistPanel({
  checklist,
  checkedAt,
  stale,
}: {
  checklist: Checklist;
  checkedAt: string | null;
  stale: boolean;
}) {
  const pass = checklist.verdict === "pass";
  const failed = checklist.items.filter((i) => i.status === "FAIL").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          Checklist (FORM②)
          <span className="text-xs font-normal text-muted-foreground">
            {formatDateTime(checkedAt)}
          </span>
        </CardTitle>
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            pass
              ? "border-success/40 bg-success/10 text-success"
              : "border-warning/40 bg-warning/10 text-warning",
          )}
        >
          {pass ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {pass
            ? "All items PASS — ready to submit to the Tech Lead."
            : `Revisions needed — ${failed} item${failed === 1 ? "" : "s"} FAIL. Revise per the suggestions and check again.`}
        </div>
        {stale ? (
          <p className="text-xs text-warning">
            The sheet changed since this check — run the checklist again.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {CHECKLIST_GROUPS.map((group) => {
          const items = checklist.items.filter((i) => i.id.startsWith(`${group.prefix}-`));
          if (!items.length) return null;
          return (
            <div key={group.prefix}>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-sm">
                    <Badge
                      variant={item.status === "PASS" ? "secondary" : "destructive"}
                      className="mt-0.5 w-14 shrink-0 justify-center font-mono"
                    >
                      {item.id}
                    </Badge>
                    <div className="min-w-0">
                      <StatusBadge
                        variant={item.status === "PASS" ? "success" : "failed"}
                        label={item.status}
                      />
                      {item.reason ? (
                        <span className="text-muted-foreground"> — {item.reason}</span>
                      ) : null}
                      {item.suggestion ? (
                        <p className="mt-0.5 text-xs text-warning">💡 {item.suggestion}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
