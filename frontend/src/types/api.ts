/** Mirrors the Pydantic schemas in app/schemas/. */

export type StatusCategory = "todo" | "in_progress" | "done";
export type JobStatus = "none" | "idle" | "queued" | "running" | "done" | "ready" | "failed";
export type SyncRunStatus = "running" | "success" | "failed";
export type ReportStatus = "pending" | "generating" | "ready" | "failed";
/** Who owns a sprint/task row: a connector, or the Scrums tab. */
export type EntitySource = "sync" | "local";

export interface ProjectListItem {
  id: number;
  name: string;
  key: string | null;
  description: string | null;
  task_count: number;
}

export interface AnalysisProvider {
  key: string;
  label: string;
  available: boolean;
}

export interface ProjectDetail {
  id: number;
  name: string;
  key: string | null;
  description: string | null;
  analysis_provider: string;
  analysis_model: string | null;
  deliverables_status: JobStatus;
  deliverables_error: string | null;
  deliverables_model: string | null;
  deliverables_generated_at: string | null;
  analysis_providers: AnalysisProvider[];
  claude_models: string[];
}

export interface Member {
  id: number;
  display_name: string;
  primary_email: string | null;
}

export interface Identity {
  id: number;
  system: string;
  external_id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  member_id: number | null;
}

export interface PlatformIdentities {
  platform: string;
  label: string;
  accounts: Identity[];
}

export interface ProjectMembers {
  members: Member[];
  available: Member[];
  identities: PlatformIdentities[];
}

/** Per-member data selection; drives that member's KPI/Evaluation generation. */
export interface AnalysisScope {
  sprint_ids: number[];
  repo_ids: number[];
  start_date: string | null;
  end_date: string | null;
}

export interface IntegrationType {
  key: string;
  label: string;
  configurable: boolean;
}

export interface Integration {
  id: number;
  type: string;
  base_url: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  has_credentials: boolean;
}

export interface ProjectIntegrations {
  types: IntegrationType[];
  items: Integration[];
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface DiscoveredRepo {
  full_name: string;
  url: string | null;
  description: string | null;
  private: boolean;
  archived: boolean;
  updated_at: string | null;
}

export interface RepoDiscovery {
  owner: string | null;
  repos: DiscoveredRepo[];
}

export interface SyncRun {
  id: number;
  integration_id: number;
  status: SyncRunStatus;
  started_at: string | null;
  finished_at: string | null;
  stats: Record<string, number> | null;
  error: string | null;
}

export interface SyncRunListItem extends SyncRun {
  integration_type: string;
}

export interface SyncStatus {
  integration_id: number;
  syncing: boolean;
  run: SyncRun | null;
}

export interface Sprint {
  id: number;
  name: string;
  state: string | null;
  start_date: string | null;
  end_date: string | null;
  goal: string | null;
  source: EntitySource;
  /** Points frozen when the sprint was started — the burndown's baseline. */
  committed_points: number | null;
  task_count: number;
  working_days?: number | null;
}

export interface Task {
  id: number;
  /** null for locally-created tasks — render taskLabel(t), not this. */
  external_key: string | null;
  title: string;
  issue_type: string | null;
  status: string | null;
  status_category: StatusCategory;
  story_points: number | null;
  sprint_id: number | null;
  source: EntitySource;
  parent_id: number | null;
  rank: number;
  priority: string | null;
  assignee_name: string | null;
  assignee_member_id: number | null;
}

export interface TaskCommit {
  id: number;
  sha: string;
  authored_at: string | null;
  summary: string | null;
  author_name: string | null;
}

export interface TaskDetail {
  id: number;
  /** taskLabel(): the Jira key, or '#<id>' when local. */
  key: string | null;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  issue_type: string | null;
  status: string | null;
  status_category: StatusCategory;
  story_points: number | null;
  priority: string | null;
  source: EntitySource;
  parent_id: number | null;
  /** taskLabel() of the parent, for the "part of …" line. */
  parent_key: string | null;
  assignee_member_id: number | null;
  hours: number;
  assignee: string | null;
  sprint: string | null;
  commits: TaskCommit[];
}

export interface Repo {
  id: number;
  provider: string;
  name: string;
  url: string | null;
  sync_status: JobStatus;
  sync_error: string | null;
  synced_at: string | null;
  summary_status: JobStatus;
  commit_count: number;
  pr_count: number;
}

export interface RepoSync {
  id: number;
  sync_status: JobStatus;
  sync_error: string | null;
  synced_at: string | null;
}

export interface RepoSummaryPayload {
  overview?: string;
  tech_areas?: string[];
  activity?: string | null;
  highlights?: string[];
  contributors?: { name: string; focus: string }[];
}

export interface RepoSummary {
  repo_id: number;
  status: JobStatus;
  summary: RepoSummaryPayload | null;
  error: string | null;
  model: string | null;
  summarized_at: string | null;
}

export interface Commit {
  id: number;
  sha: string;
  message: string | null;
  authored_at: string | null;
  additions: number;
  deletions: number;
  files_changed: number;
  is_merge: boolean;
  author_name: string | null;
  author_member_id: number | null;
  analysis_status: JobStatus;
}

export interface CommitAnalysisPayload {
  categories?: string[];
  summary?: string;
  changes?: string[];
  files?: { path: string; what: string }[];
}

export interface CommitAnalysis {
  commit_id: number;
  status: JobStatus;
  analysis: CommitAnalysisPayload | null;
  error: string | null;
  model: string | null;
  analyzed_at: string | null;
}

export interface PRReview {
  state: string | null;
  reviewer_name: string | null;
  submitted_at: string | null;
}

export interface PullRequest {
  id: number;
  external_id: string;
  title: string | null;
  state: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at_src: string | null;
  merged_at_src: string | null;
  author_name: string | null;
  author_member_id: number | null;
  reviews: PRReview[];
}

export interface GanttCommit {
  id: number;
  sha: string;
  authored_at: string | null;
  summary: string | null;
  additions: number;
  deletions: number;
  author_name: string | null;
  repo_name: string | null;
  link_status: JobStatus;
}

export interface GanttItem {
  id: string;
  kind: "jira" | "commit";
  task_id: number | null;
  key: string | null;
  parent_id: number | null;
  title: string;
  status_category: StatusCategory | null;
  start: string;
  end: string;
  story_points: number | null;
  commits: GanttCommit[];
}

export interface GanttRow {
  member_id: number | null;
  display_name: string;
  items: GanttItem[];
}

export interface GanttSprint {
  id: number;
  name: string;
  state: string | null;
  start: string;
  end: string;
}

export interface GanttOut {
  rows: GanttRow[];
  sprints: GanttSprint[];
  unassigned: GanttCommit[];
  range_start: string | null;
  range_end: string | null;
}

export interface CommitLink {
  commit_id: number;
  link_status: JobStatus;
  linked_task_id: number | null;
  link_reason: string | null;
  error: string | null;
}

export interface CommitCandidateTask {
  id: number;
  key: string;
  title: string;
  status_category: StatusCategory;
  assignee_name: string | null;
  sprint_name: string | null;
}

export interface CommitDetail {
  id: number;
  sha: string;
  message: string | null;
  authored_at: string | null;
  additions: number;
  deletions: number;
  files_changed: number;
  author_name: string | null;
  summary: string | null;
  analysis: CommitAnalysisPayload | null;
  link_status: JobStatus;
  linked_task_id: number | null;
  link_reason: string | null;
  sprint_name: string | null;
  candidates: CommitCandidateTask[];
}

export interface Report {
  id: number;
  title: string;
  report_type: string;
  scope: Record<string, unknown>;
  status: ReportStatus;
  error: string | null;
  generated_at: string | null;
  created_at: string | null;
  html_url: string | null;
  pdf_url: string | null;
}

export interface Deliverable {
  id: number;
  name: string;
  description: string | null;
  status: string;
  linked_task_keys: string[];
  source: string;
  sprint_id: number | null;
}

export interface Deliverables {
  status: JobStatus;
  error: string | null;
  model: string | null;
  generated_at: string | null;
  items: Deliverable[];
}

export interface KpiMetrics {
  commits?: number;
  tasks_done?: number;
  tasks_total?: number;
  story_points_completed?: number;
  story_points_total?: number;
  story_points_allocated?: number;
  additions?: number;
  deletions?: number;
  hours_logged?: number;
  reopened?: number;
}

export interface KpiPayload {
  rating?: string | null;
  score?: number | null;
  summary?: string | null;
  strengths?: string[];
  improvements?: string[];
  metrics?: KpiMetrics;
}

export interface Kpi {
  member_id: number;
  display_name: string;
  status: JobStatus;
  kpi: KpiPayload | null;
  error: string | null;
  model: string | null;
  generated_at: string | null;
}

export type Grade = "S" | "A" | "B" | "C" | "D" | "E";

export interface AxisCells {
  planned_goal: string;
  key_results: string;
  self_eval: Grade | null;
  tech_lead_eval: Grade | null;
  final_eval: Grade | null;
}

export interface ChecklistItem {
  id: string;
  status: "PASS" | "FAIL";
  reason: string | null;
  suggestion: string | null;
}

export interface Checklist {
  verdict: "pass" | "fail";
  items: ChecklistItem[];
  /** True when the sheet's goals/results changed after this check ran. */
  stale?: boolean;
}

export interface EvaluationSummary {
  member_id: number;
  display_name: string;
  job_status: JobStatus;
  job_kind: string | null;
  has_sheet: boolean;
  checklist_verdict: "pass" | "fail" | null;
  checklist_stale: boolean;
}

export interface EvaluationSheet {
  member_id: number;
  display_name: string;
  project_key: string | null;
  project_name: string;
  tech_lead_name: string | null;
  axes: Record<string, AxisCells>;
  evidence: string | null;
  job_status: JobStatus;
  job_kind: string | null;
  job_error: string | null;
  job_model: string | null;
  goals_generated_at: string | null;
  results_generated_at: string | null;
  checked_at: string | null;
  checklist: Checklist | null;
  updated_at: string | null;
}

export interface AnalyzeAll {
  queued: number;
  commit_ids: number[];
}

export interface ClaudeStatus {
  version: string | null;
  authed: boolean;
}

export interface ClaudeTest {
  ok: boolean;
  model: string | null;
  error: string | null;
}

export interface ClaudeTokenResult {
  ok: boolean;
  error: string | null;
  authed: boolean;
}

export interface StoryPointRow {
  id?: number;
  points: number;
  min_hours: number | null;
  max_hours: number | null;
  risk: string;
  needs_breakdown: boolean;
  note: string | null;
}

export interface SprintCapacityMember {
  member_id: number;
  display_name: string;
  focus_factor: number;
  allocated_points: number;
  completed_points: number;
  delta: number;
  over_capacity: boolean;
}

export interface SprintCapacity {
  sprint_id: number;
  name: string;
  state: string | null;
  start_date: string | null;
  end_date: string | null;
  working_days: number;
  working_days_override: number | null;
  team_capacity: number;
  team_completed: number;
  members: SprintCapacityMember[];
}

/** PUT body for a sprint's capacity. */
export interface SprintCapacityIn {
  working_days: number | null;
  members: { member_id: number; focus_factor: number }[];
}

// ---------------------------------------------------------------- Scrums

/** POST /projects/:id/tasks */
export interface TaskCreateIn {
  title: string;
  description?: string | null;
  acceptance_criteria?: string | null;
  issue_type?: string | null;
  status?: string | null;
  status_category?: StatusCategory;
  story_points?: number | null;
  priority?: string | null;
  sprint_id?: number | null;
  parent_id?: number | null;
  assignee_member_id?: number | null;
}

/** PATCH /tasks/:id — omitted keys are left alone, null clears the field. */
export type TaskPatchIn = Partial<TaskCreateIn>;

/**
 * POST /tasks/:id/rank — positional, never a rank value. `after_task_id: null`
 * means "first in the target list"; the server assigns the actual rank.
 */
export interface RankMoveIn {
  sprint_id: number | null;
  after_task_id: number | null;
}

export interface BulkMoveIn {
  task_ids: number[];
  sprint_id: number | null;
}

export interface TaskNode extends Task {
  children: TaskNode[];
  /** Points summed over leaf descendants; own story_points for a leaf. */
  rollup_points: number;
}

export interface BacklogSprintBucket {
  sprint_id: number;
  name: string;
  state: string | null;
  source: EntitySource;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  tasks: Task[];
  committed_points: number;
  completed_points: number;
  /** null when no member has a focus factor set for the sprint. */
  capacity_points: number | null;
}

export interface BacklogBoard {
  backlog: Task[];
  sprints: BacklogSprintBucket[];
  backlog_points: number;
}

export interface SprintCreateIn {
  name: string;
  goal?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  state?: string | null;
  working_days?: number | null;
}

export type SprintPatchIn = Partial<SprintCreateIn>;

export interface SprintCompleteIn {
  /** Where unfinished tasks go. null = the backlog. */
  move_incomplete_to: number | null;
}

export interface SprintCompleteOut {
  sprint_id: number;
  completed_tasks: number;
  completed_points: number;
  moved_tasks: number;
  moved_to_sprint_id: number | null;
}

export interface SprintCommitment {
  sprint_id: number;
  name: string;
  committed_points: number;
  completed_points: number;
  /** null = no capacity set, which is "unknown", not "no room". */
  capacity_points: number | null;
  working_days: number;
  unestimated_tasks: number;
  over_capacity: boolean;
}
