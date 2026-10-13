import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { Me, ProjectRole } from "@/types/api";

/**
 * Mirror of ROLE_CAPS in app/api/authz.py. Used only to hide what a user can't
 * do — the server is the enforcer, so a drift here shows a button that 403s
 * rather than opening a hole. Keep the two in step.
 */
export type Cap =
  | "view"
  | "report"
  | "roadmap"
  | "task"
  | "plan"
  | "poker_vote"
  | "poker_facilitate"
  | "people"
  | "people_manage"
  | "members"
  | "ops"
  | "docs"
  | "terminal"
  | "admin";

const ROLE_CAPS: Record<ProjectRole, ReadonlySet<Cap>> = {
  vp_product: new Set(["view", "report", "roadmap", "poker_vote", "docs"]),
  tech_lead: new Set([
    "view", "report", "roadmap", "task", "plan", "poker_vote", "poker_facilitate",
    "people", "people_manage", "ops", "docs", "terminal",
  ]),
  project_manager: new Set([
    "view", "report", "roadmap", "task", "plan", "poker_vote", "poker_facilitate",
    "people", "people_manage", "members", "ops", "docs",
  ]),
  developer: new Set(["view", "task", "poker_vote", "people"]),
};

export const ROLE_LABELS: Record<ProjectRole, string> = {
  vp_product: "VP of Product",
  tech_lead: "Tech Lead",
  project_manager: "Project Manager",
  developer: "Developer",
};

export const ROLES = Object.keys(ROLE_LABELS) as ProjectRole[];

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<Me>("/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export interface ProjectAccess {
  role: ProjectRole | null;
  isAdmin: boolean;
  /** False for developers: KPI/evaluation rows are limited to their own. */
  seesAllPeople: boolean;
  memberId: number | null;
  can: (cap: Cap) => boolean;
}

export function accessFor(me: Me | undefined, projectId?: number): ProjectAccess {
  const isAdmin = !!me?.is_admin;
  const role =
    projectId === undefined
      ? null
      : (me?.memberships.find((m) => m.project_id === projectId)?.role ?? null);
  return {
    role,
    isAdmin,
    seesAllPeople: isAdmin || role === "tech_lead" || role === "project_manager",
    memberId: me?.member_id ?? null,
    can: (cap) => isAdmin || (cap !== "admin" && !!role && ROLE_CAPS[role].has(cap)),
  };
}

/** The signed-in user's rights, on a project when `projectId` is given. */
export function useAccess(projectId?: number): ProjectAccess {
  return accessFor(useMe().data, projectId);
}
