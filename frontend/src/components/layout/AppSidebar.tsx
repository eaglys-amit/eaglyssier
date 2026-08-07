import { FolderKanban, Users } from "lucide-react";
import { NavLink } from "react-router-dom";

import dossierMark from "@/assets/eaglyssier-mark.png";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";

const NAV = [
  {
    heading: "Workspace",
    items: [
      { to: "/projects", label: "Projects", icon: FolderKanban },
      { to: "/members", label: "Members", icon: Users },
    ],
  },
];

export function AppSidebar() {
  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      {/* h-19 + border-b matches PageHeader, so the two line up across the seam. */}
      <div className="flex h-19 shrink-0 items-center gap-2 border-b px-4">
        <img src={dossierMark} alt="Eaglyssier" className="size-8 shrink-0" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Eaglyssier</div>
          <div className="text-xs text-muted-foreground">Project reports & analytics</div>
        </div>
      </div>

      <nav className="flex-1 space-y-6 px-3 py-2">
        {NAV.map((section) => (
          <div key={section.heading}>
            <div className="px-2 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              {section.heading}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )
                    }
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between border-t px-4 py-3">
        <span className="text-xs text-muted-foreground">Theme</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
