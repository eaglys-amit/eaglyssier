import { Navigate, createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { MembersPage } from "@/features/members/MembersPage";
import { NotFoundPage } from "@/features/NotFoundPage";
import { ProjectDetailLayout } from "@/features/project-detail/ProjectDetailLayout";
import { ProjectSettingsPage } from "@/features/project-detail/ProjectSettingsPage";
import { PROJECT_SETTINGS } from "@/features/project-detail/settings-nav";
import { ProjectsPage } from "@/features/projects/ProjectsPage";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/projects" replace /> },
      { path: "/projects", element: <ProjectsPage /> },
      { path: "/projects/:projectId", element: <ProjectDetailLayout /> },
      // Setup pages keep their original URLs but render standalone, outside the
      // analysis tab strip. Static segments outrank the :tab route below.
      ...PROJECT_SETTINGS.map((s) => ({
        path: `/projects/:projectId/${s.key}`,
        element: <ProjectSettingsPage section={s.key} />,
      })),
      { path: "/projects/:projectId/:tab", element: <ProjectDetailLayout /> },
      { path: "/members", element: <MembersPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
