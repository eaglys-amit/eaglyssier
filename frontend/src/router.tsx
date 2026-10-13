import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { HomePage } from "@/features/HomePage";
import { MembersPage } from "@/features/members/MembersPage";
import { NotFoundPage } from "@/features/NotFoundPage";
import { PortfolioPage } from "@/features/portfolio/PortfolioPage";
import { ProjectDetailLayout } from "@/features/project-detail/ProjectDetailLayout";
import { ProjectSettingsPage } from "@/features/project-detail/ProjectSettingsPage";
import { ProjectShell } from "@/features/project-detail/ProjectShell";
import { PROJECT_SETTINGS } from "@/features/project-detail/settings-nav";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { UsersPage } from "@/features/users/UsersPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  // Everything else needs a session; RequireAuth sends strangers to /login.
  {
    element: <RequireAuth />,
    children: [
      // Workspace pages run full width — the only nav they need is on the home page.
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/portfolio", element: <PortfolioPage /> },
          { path: "/projects", element: <ProjectsPage /> },
          { path: "/members", element: <MembersPage /> },
          { path: "/users", element: <UsersPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
      // Inside a project the shell carries the project's own sidebar.
      {
        path: "/projects/:projectId",
        element: <ProjectShell />,
        children: [
          // No tab in the URL: ProjectDetailLayout redirects to the default one.
          { index: true, element: <ProjectDetailLayout /> },
          // Setup sections live in the sidebar, outside the analysis tab strip.
          // Static segments must outrank the :tab route below.
          ...PROJECT_SETTINGS.map((s) => ({
            path: s.key,
            element: <ProjectSettingsPage section={s.key} />,
          })),
          { path: ":tab", element: <ProjectDetailLayout /> },
        ],
      },
    ],
  },
]);
