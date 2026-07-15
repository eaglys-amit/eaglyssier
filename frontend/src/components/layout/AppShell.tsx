import { Outlet } from "react-router-dom";

import { AppSidebar } from "@/components/layout/AppSidebar";

export function AppShell() {
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
