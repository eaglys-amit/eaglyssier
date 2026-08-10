import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";

/**
 * The window frame every route renders in.
 *
 * The sidebar is a slot, not a fixture: the workspace pages (home, projects,
 * members) run full width, and only a project hands one in — see ProjectShell.
 * `children` likewise overrides the routed outlet, so a wrapping shell can show
 * a loading state in the content column while keeping its own chrome.
 */
export function AppShell({ sidebar, children }: { sidebar?: ReactNode; children?: ReactNode }) {
  return (
    // Viewport-height shell: the page scroll lives in the content column, not on
    // the document, so a route can hand its own height to fixed-height children.
    <div className="flex h-screen overflow-hidden">
      {sidebar}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* No padding here: each page opens with a full-bleed PageHeader and
            pads its own body. */}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {children ?? <Outlet />}
        </div>
      </main>
    </div>
  );
}
