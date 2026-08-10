import { ArrowLeft, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

/**
 * The content column's title bar. Fixed at the same height as the sidebar's
 * header block (`h-19`) and bordered like it, so the two read as one bar across
 * the whole window. Keep it to two lines — a back link *or* a description under
 * the title — or it will outgrow that height.
 *
 * Sticky by default: it sits inside the scrolling column, so on a long page it
 * pins to the top instead of scrolling away. That needs an opaque background to
 * cover the content passing under it. Pass `sticky={false}` when something else
 * already owns the top of the column — the project tab strip does, and the
 * per-tab bar below it scrolls away with the content.
 */
export function PageHeader({
  leading,
  backTo,
  backLabel,
  icon: Icon,
  title,
  description,
  badge,
  actions,
  sticky = true,
}: {
  leading?: ReactNode;
  backTo?: string;
  backLabel?: ReactNode;
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  sticky?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex h-19 shrink-0 items-center gap-3 border-b bg-background px-6",
        sticky && "sticky top-0 z-30",
      )}
    >
      {/* Ahead of the title, behind a rule: the brand on the pages that have no
          sidebar to carry it. */}
      {leading ? (
        <>
          {leading}
          <div className="h-8 w-px shrink-0 bg-border" />
        </>
      ) : null}
      <div className="min-w-0 flex-1">
        {backTo ? (
          <Link
            to={backTo}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {backLabel}
          </Link>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="size-5 shrink-0 text-muted-foreground" /> : null}
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {!backTo && description ? (
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}
