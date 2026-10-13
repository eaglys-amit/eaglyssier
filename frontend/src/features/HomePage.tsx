import {
  ArrowRight,
  FolderKanban,
  LayoutDashboard,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import { BrandLink } from "@/components/layout/BrandLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UserMenu } from "@/features/auth/UserMenu";
import { Card, CardContent } from "@/components/ui/card";
import { useAccess, useMe } from "@/lib/permissions";

const DESTINATIONS = [
  {
    to: "/portfolio",
    label: "Portfolio",
    icon: LayoutDashboard,
    blurb: "Delivery health across your projects: sprints, velocity, and milestones.",
  },
  {
    to: "/projects",
    label: "Projects",
    icon: FolderKanban,
    blurb: "Agile project reports from Jira, GitHub, and GitLab data.",
  },
  {
    to: "/members",
    label: "Members",
    icon: Users,
    blurb: "The curated people directory, mapped to synced platform accounts.",
  },
  {
    to: "/users",
    label: "Users",
    icon: UserCog,
    blurb: "Logins, admin rights, and which member each login belongs to.",
    adminOnly: true,
  },
] satisfies ReadonlyArray<{
  to: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  adminOnly?: boolean;
}>;

/**
 * The front door. A handful of destinations (Users only for admins), so it
 * says so plainly rather than hiding them in a sidebar that would then follow
 * you into a project, where the nav belongs to the project instead.
 */
export function HomePage() {
  const { isAdmin } = useAccess();
  const { data: me } = useMe();
  // The portfolio is a VP's starting point, so it leads for them; for everyone
  // else the project list does.
  const isVp = !!me?.memberships.some((m) => m.role === "vp_product");
  const destinations = DESTINATIONS.filter((d) => isAdmin || !("adminOnly" in d));
  if (!isVp) [destinations[0], destinations[1]] = [destinations[1], destinations[0]];
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        leading={<BrandLink />}
        title="Workspace"
        description="Project reports & analytics."
        actions={
          <>
            <UserMenu />
            <ThemeToggle />
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-6 py-16">
        <div className="grid w-full gap-4 sm:grid-cols-2">
          {destinations.map((d) => (
            <Link key={d.to} to={d.to} className="group rounded-xl">
              <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/40">
                <CardContent className="flex h-full flex-col gap-2 p-5">
                  <d.icon className="size-6 text-muted-foreground transition-colors group-hover:text-primary" />
                  <div className="flex items-center gap-1.5 font-medium">
                    {d.label}
                    <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                  </div>
                  <p className="text-sm text-muted-foreground">{d.blurb}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
