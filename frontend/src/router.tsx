import { Navigate, createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { MembersPage } from "@/features/members/MembersPage";
import { NotFoundPage } from "@/features/NotFoundPage";
import { ProjectDetailLayout } from "@/features/project-detail/ProjectDetailLayout";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { StoryPointsPage } from "@/features/settings/StoryPointsPage";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/projects" replace /> },
      { path: "/projects", element: <ProjectsPage /> },
      { path: "/projects/:projectId", element: <ProjectDetailLayout /> },
      { path: "/projects/:projectId/:tab", element: <ProjectDetailLayout /> },
      { path: "/members", element: <MembersPage /> },
      { path: "/settings/story-points", element: <StoryPointsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
