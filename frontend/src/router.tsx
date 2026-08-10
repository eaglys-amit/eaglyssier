import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { HomePage } from "@/features/HomePage";
import { MembersPage } from "@/features/members/MembersPage";
import { NotFoundPage } from "@/features/NotFoundPage";
import { ProjectDetailLayout } from "@/features/project-detail/ProjectDetailLayout";
import { ProjectSettingsPage } from "@/features/project-detail/ProjectSettingsPage";
import { ProjectShell } from "@/features/project-detail/ProjectShell";
import { PROJECT_SETTINGS } from "@/features/project-detail/settings-nav";
import { ProjectsPage } from "@/features/projects/ProjectsPage";

export const router = createBrowserRouter([
  // Workspace pages run full width — the only nav they need is on the home page.
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/projects", element: <ProjectsPage /> },
      { path: "/members", element: <MembersPage /> },
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
]);
