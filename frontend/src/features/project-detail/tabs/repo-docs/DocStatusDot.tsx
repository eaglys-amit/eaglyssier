import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RepoDoc } from "@/types/api";

/**
 * A document's state, at rail scale.
 *
 * jobBadge is too wide for a 288px rail beside a long title, so this is the
 * same information as a 6px dot — with `title` and an `sr-only` label, because
 * colour alone is not information anyone can rely on.
 */
export function DocStatusDot({ doc }: { doc: RepoDoc }) {
  const { className, label } = describe(doc);

  if (doc.status === "running") {
    return (
      <span className="shrink-0" title={label}>
        <Loader2 className="text-primary size-3 animate-spin" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span className="shrink-0" title={label}>
      <span className={cn("block size-1.5 rounded-full", className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function describe(doc: RepoDoc): { className: string; label: string } {
  switch (doc.status) {
    case "running":
      return { className: "bg-primary", label: "Being written" };
    case "queued":
      return { className: "bg-primary/50", label: "Queued" };
    case "failed":
      return { className: "bg-destructive", label: "Failed" };
    default:
      return doc.has_content
        ? { className: "bg-success", label: "Written" }
        : { className: "bg-muted-foreground/30", label: "Not generated yet" };
  }
}
