import type { ReactNode } from "react";

import { PageHeader } from "@/components/layout/PageHeader";

import { PROJECT_TABS, type TabKey } from "@/features/project-detail/tabs-nav";

/**
 * The frame every analysis tab opens with: a full-bleed title bar naming the
 * tab, then the padded body. The title, icon, and blurb come from PROJECT_TABS,
 * so a tab only supplies its own controls — whatever used to sit in a toolbar
 * row of its own goes in `actions`.
 *
 * The tab owns this rather than the layout because the bar has to run edge to
 * edge while the body is padded, and because the controls belong to the tab.
 */
export function TabShell({
  tab,
  actions,
  children,
}: {
  tab: TabKey;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const meta = PROJECT_TABS.find((t) => t.key === tab)!;

  return (
    // h-full + min-h-0 keeps the full-height contract the Data and Scrums tabs
    // rely on (they scroll inside their panels instead of scrolling the page).
    <div className="flex h-full flex-col">
      <PageHeader
        sticky={false}
        icon={meta.icon}
        title={meta.label}
        description={meta.blurb}
        actions={actions}
      />
      <div className="min-h-0 flex-1 p-6">{children}</div>
    </div>
  );
}
