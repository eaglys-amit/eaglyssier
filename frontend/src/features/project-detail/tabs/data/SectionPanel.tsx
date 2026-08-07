import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

/**
 * One half of the Data tab's side-by-side split.
 *
 * The header is not a toggle — clicking it does nothing, so the controls in it
 * are safe to hit. Width is what moves instead: `widthAction` gives the panel
 * the rest of the row, which narrows the other one to a header-only strip
 * (`collapsed`).
 */
export function SectionPanel({
  title,
  count,
  subtitle,
  sync,
  actions,
  widthAction,
  collapsed = false,
  children,
}: {
  title: string;
  count?: number;
  /** Second header line — where this panel's source status lives. */
  subtitle?: ReactNode;
  /** Sync controls for this panel's sources — shown even while narrowed. */
  sync?: ReactNode;
  /** Controls that only make sense against visible content. */
  actions?: ReactNode;
  /** The give-this-panel-the-width button. */
  widthAction?: ReactNode;
  /** Parked as a rail so the other panel can take the width. */
  collapsed?: boolean;
  children: ReactNode;
}) {
  if (collapsed) {
    // A rail rather than a narrow copy of the header: 44px instead of 288px
    // hands the difference to the open panel. Only the title, the count, and
    // the way back fit — expand it to reach the sync controls.
    return (
      <div className="flex h-full flex-col items-center gap-2 rounded-lg border bg-muted/20 py-2">
        {widthAction}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          {/* vertical-rl + rotate-180 reads bottom-to-top, the usual direction
              for a left-hand rail. */}
          <span className="max-h-full rotate-180 truncate text-sm font-semibold tracking-tight [writing-mode:vertical-rl]">
            {title}
          </span>
        </div>
        {count != null ? (
          <Badge variant="secondary" className="px-1.5 font-mono tabular-nums">
            {count}
          </Badge>
        ) : null}
      </div>
    );
  }

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
          {widthAction}
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
