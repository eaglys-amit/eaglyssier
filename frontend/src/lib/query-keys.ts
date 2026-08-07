/** Hierarchical query keys: invalidating ["projects", id] refreshes every sub-resource. */
export const qk = {
  projects: ["projects"] as const,
  project: (id: number) => ["projects", id] as const,
  sprints: (id: number) => ["projects", id, "sprints"] as const,
  tasks: (id: number) => ["projects", id, "tasks"] as const,
  gantt: (id: number) => ["projects", id, "gantt"] as const,
  task: (taskId: number) => ["tasks", taskId] as const,
  repos: (id: number) => ["projects", id, "repos"] as const,
  commits: (repoId: number) => ["repos", repoId, "commits"] as const,
  pulls: (repoId: number) => ["repos", repoId, "pulls"] as const,
  repoSummary: (repoId: number) => ["repos", repoId, "summary"] as const,
  repoSync: (repoId: number) => ["repos", repoId, "sync"] as const,
  commitAnalysis: (commitId: number) => ["commits", commitId, "analysis"] as const,
  commitDetail: (commitId: number) => ["commits", commitId, "detail"] as const,
  reports: (id: number) => ["projects", id, "reports"] as const,
  deliverables: (id: number) => ["projects", id, "deliverables"] as const,
  kpi: (id: number) => ["projects", id, "kpi"] as const,
  evaluation: (id: number) => ["projects", id, "evaluation"] as const,
  evaluationSheet: (id: number, memberId: number) =>
    ["projects", id, "evaluation", memberId] as const,
  integrations: (id: number) => ["projects", id, "integrations"] as const,
  syncStatus: (integrationId: number) => ["integrations", integrationId, "sync-status"] as const,
  syncRuns: (id: number) => ["projects", id, "sync-runs"] as const,
  projectMembers: (id: number) => ["projects", id, "members"] as const,
  memberScope: (id: number, memberId: number) =>
    ["projects", id, "members", memberId, "scope"] as const,
  members: ["members"] as const,
  claudeStatus: ["provider", "claude", "status"] as const,
  storyPoints: (id: number) => ["projects", id, "story-points"] as const,
  capacity: (id: number) => ["projects", id, "capacity"] as const,
  // Scrums. Under ["projects", id] so a sync invalidation sweeps them too.
  board: (id: number) => ["projects", id, "scrums", "board"] as const,
  taskTree: (id: number) => ["projects", id, "scrums", "task-tree"] as const,
  commitment: (id: number, sprintId: number) =>
    ["projects", id, "scrums", "commitment", sprintId] as const,
  deck: (id: number) => ["projects", id, "story-points", "deck"] as const,
  scaleSources: (id: number) => ["projects", id, "story-points", "sources"] as const,
  scaleViolations: (id: number) => ["projects", id, "story-points", "violations"] as const,
  memberSyncPreview: (id: number) => ["projects", id, "members", "sync-preview"] as const,
  pokerSessions: (id: number) => ["projects", id, "poker"] as const,
  // Outside the project subtree: it's polled by id every 2s and must not be
  // swept by a project-wide invalidation mid-round.
  pokerSession: (sessionId: number) => ["poker", sessionId] as const,
  referenceFiles: (id: number) => ["projects", id, "references"] as const,
  breakdowns: (id: number) => ["projects", id, "breakdowns"] as const,
  // Outside the project subtree: polled by id while generating, and must not be
  // swept by a project-wide invalidation mid-job.
  breakdown: (breakdownId: number) => ["breakdowns", breakdownId] as const,
};
