import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

/**
 * A Data view's frame: a header with the source's sync controls and status,
 * and a list that scrolls beneath it.
 */
export function SectionPanel({
  title,
  count,
  subtitle,
  sync,
  actions,
  children,
}: {
  title: string;
  count?: number;
  /** Second header line — where this panel's source status lives. */
  subtitle?: ReactNode;
  /** Sync controls for this panel's sources. */
  sync?: ReactNode;
  /** Controls that only make sense against visible content. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border bg-muted/20">
      {/* Outside the scroll area, so it stays put while the list under it scrolls. */}
      <div className="shrink-0 rounded-t-lg border-b bg-muted px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
            {count != null ? (
              <Badge variant="secondary" className="font-mono tabular-nums">
                {count}
              </Badge>
            ) : null}
          </div>
          {sync}
          {actions}
        </div>
        {subtitle ? <div className="mt-1.5">{subtitle}</div> : null}
      </div>
      {/* `relative` matters: absolutely positioned descendants (every button's
          sr-only label) would otherwise resolve against the viewport, escape
          this container's clipping, and stretch the document's scroll area. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </div>
  );
}
