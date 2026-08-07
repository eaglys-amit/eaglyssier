import { Outlet } from "react-router-dom";

import { AppSidebar } from "@/components/layout/AppSidebar";

export function AppShell() {
  return (
    // Viewport-height shell: the page scroll lives in the content column, not on
    // the document, so a route can hand its own height to fixed-height children.
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* No padding here: each page opens with a full-bleed PageHeader and
            pads its own body. */}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
