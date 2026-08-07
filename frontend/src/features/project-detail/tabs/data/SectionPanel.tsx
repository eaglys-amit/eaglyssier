import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * One half of the Data tab's side-by-side split. Collapsing a panel is what
 * gives the other one room, so the header stays readable at any width and the
 * body scrolls on its own instead of stretching the page to the taller side.
 */
export function SectionPanel({
  title,
  count,
  actions,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-lg border bg-muted/20"
    >
      <div className={cn("flex items-center gap-2 px-3 py-2", open && "border-b")}>
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
          {count != null ? (
            <Badge variant="secondary" className="font-mono tabular-nums">
              {count}
            </Badge>
          ) : null}
        </CollapsibleTrigger>
        {open ? actions : null}
      </div>
      <CollapsibleContent>
        <div className="max-h-[70vh] overflow-y-auto p-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
