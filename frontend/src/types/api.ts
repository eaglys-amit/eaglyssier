/** Mirrors the Pydantic schemas in app/schemas/. */

export type StatusCategory = "todo" | "in_progress" | "done";
export type JobStatus = "none" | "idle" | "queued" | "running" | "done" | "ready" | "failed";
export type SyncRunStatus = "running" | "success" | "failed";
export type ReportStatus = "pending" | "generating" | "ready" | "failed";
/** Who owns a sprint/task row: a connector, or the Scrums tab. */
export type EntitySource = "sync" | "local";
/** Where a task's story points came from. null = a connector supplied them. */
export type EstimateSource = "ai" | "poker" | "manual" | null;

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
  /**
   * A clipped, whitespace-collapsed first line of the description, for list
   * rows. Not the real description — fetch /tasks/{id} for that.
   */
  description_preview: string | null;
  issue_type: string | null;
  status: string | null;
  status_category: StatusCategory;
  story_points: number | null;
  sprint_id: number | null;
  /** The milestone this counts toward. Sync never writes it, so it survives a re-sync. */
  milestone_id: number | null;
  source: EntitySource;
  parent_id: number | null;
  rank: number;
  priority: string | null;
  /** 'ai' means proposed by a breakdown and not yet agreed by the team. */
  estimate_source: EstimateSource;
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
  project_id: number;
  milestone_id: number | null;
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
  milestone_id?: number | null;
  parent_id?: number | null;
  assignee_member_id?: number | null;
}

/** PATCH /tasks/:id — omitted keys are left alone, null clears the field. */
export type TaskPatchIn = Partial<TaskCreateIn>;

/**
 * POST /tasks/:id/jira-key — hand a local task over to the tracker.
 *
 * Not part of TaskPatchIn: the key is a state transition, not an edit. The task
 * stays local until a sync finds the issue and adopts the row, which is what
 * keeps the estimate and epic grouping instead of a duplicate arriving. Null
 * undoes a typo.
 */
export interface TaskLinkKeyIn {
  external_key: string | null;
}

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

// --- story-point scale: the deck, import, and violations ----------------

export interface Deck {
  points: number[];
  /** Values the scale flags as too big to work on directly. */
  needs_breakdown: number[];
  /** points -> the scale row's note, for a card tooltip. */
  labels: Record<string, string>;
}

export interface StoryPointScaleSource {
  project_id: number;
  project_name: string;
  project_key: string | null;
  row_count: number;
}

export interface StoryPointScaleImportIn {
  source_project_id: number;
  mode: "replace" | "merge";
}

export type ScaleViolationKind =
  | "off_deck"
  | "needs_breakdown"
  | "hours_below_min"
  | "hours_above_max";

export interface ScaleViolation {
  task_id: number;
  task_key: string;
  title: string;
  kind: ScaleViolationKind;
  points: number | null;
  hours: number | null;
  min_hours: number | null;
  max_hours: number | null;
  message: string;
}

// --- identity -> member matching ----------------------------------------

export interface MemberSyncCandidate {
  identity_id: number;
  system: string;
  external_id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  current_member_id: number | null;
  match_member_id: number | null;
  match_display_name: string | null;
  match_reason: "email" | "username" | "display_name" | null;
  /** exact = matched on email; likely = a unique name/handle hit. */
  confidence: "exact" | "likely" | "none";
  /** False when applying the match would also enrol the member. */
  match_on_project: boolean;
  suggested_display_name: string;
}

export interface MemberSyncPreview {
  candidates: MemberSyncCandidate[];
  total: number;
  already_mapped: number;
  matched: number;
  unmatched: number;
}

export interface MemberSyncApplyIn {
  mappings: { identity_id: number; member_id: number | null }[];
  create_members: { identity_id: number; display_name: string; primary_email: string | null }[];
}

export interface MemberSyncApplyOut {
  created: number;
  mapped: number;
  unmapped: number;
}

// ---------------------------------------------------------- planning poker

export type PokerRoundStatus = "voting" | "revealed" | "applied" | "skipped";

export interface PokerVote {
  member_id: number;
  display_name: string;
  voted_at: string | null;
  /** Withheld by the server until the round is revealed — gate on round.status. */
  points: number | null;
  abstain: boolean | null;
}

export interface PokerParticipant {
  member_id: number;
  display_name: string;
  has_voted: boolean;
  /** Voted, then left the project; their card still counts for this round. */
  off_project: boolean;
}

export interface PokerStats {
  votes: number;
  abstains: number;
  low: number | null;
  high: number | null;
  median: number | null;
  consensus: boolean;
  /** The median rounded up to a real card. */
  suggested: number | null;
}

export interface PokerRound {
  id: number;
  session_id: number;
  task_id: number;
  task_key: string | null;
  task_title: string;
  /** The context needed to estimate — a title alone isn't enough. */
  task_description: string | null;
  task_acceptance_criteria: string | null;
  task_issue_type: string | null;
  attempt: number;
  status: PokerRoundStatus;
  final_points: number | null;
  note: string | null;
  revealed_at: string | null;
  applied_at: string | null;
  votes: PokerVote[];
  /** Null while voting. */
  stats: PokerStats | null;
  /** What the AI had proposed. Withheld until reveal, so it can't anchor votes. */
  proposed_points: number | null;
}

export interface PokerQueueItem {
  task_id: number;
  task_key: string | null;
  task_title: string;
  task_description: string | null;
  story_points: number | null;
  round_status: PokerRoundStatus | null;
  attempts: number;
}

export interface PokerSession {
  id: number;
  project_id: number;
  sprint_id: number | null;
  sprint_name: string | null;
  name: string;
  status: "open" | "closed";
  /** Whoever started the session — the only member who may reveal. */
  facilitator_member_id: number | null;
  facilitator_name: string | null;
  /** Snapshotted at creation, so a mid-session scale edit can't change the cards. */
  deck: number[];
  breakdown_points: number[];
  created_at: string | null;
  closed_at: string | null;
  queued: number;
  estimated: number;
}

export interface PokerSessionDetail extends PokerSession {
  participants: PokerParticipant[];
  current_round: PokerRound | null;
  queue: PokerQueueItem[];
}

export interface PokerSessionCreateIn {
  name?: string | null;
  sprint_id?: number | null;
  /** Empty = every unestimated leaf task in the sprint. */
  task_ids?: number[];
}

export interface PokerVoteIn {
  member_id: number;
  points: number | null;
  abstain: boolean;
}

export interface PokerApplyIn {
  points: number;
  note?: string | null;
}

export interface PokerApplyOut {
  round: PokerRound;
  task_id: number;
  story_points: number;
  warnings: string[];
}

// ------------------------------------------------------- reference documents

export type ReferenceKind = "md" | "txt" | "html" | "pdf" | "pptx";

/**
 * A folder in the document tree, flat — `parent_id: null` is a top-level folder.
 * The server sends the whole set unnested and the UI assembles it, the same way
 * the board reads tasks flat and TaskTreeView nests them on render.
 */
export interface ReferenceFolder {
  id: number;
  project_id: number;
  parent_id: number | null;
  name: string;
  created_at: string | null;
}

export interface ReferenceFile {
  id: number;
  project_id: number;
  task_id: number | null;
  /** null = filed at the project root. */
  folder_id: number | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  kind: ReferenceKind;
  extract_status: JobStatus;
  extract_error: string | null;
  /** 0 with status 'ready' means no extractable text — a scanned PDF, typically. */
  char_count: number;
  created_at: string | null;
  view_url: string | null;
  download_url: string | null;
}

export interface RejectedFile {
  filename: string;
  reason: string;
}

/** Uploads succeed per file, so rejections come back beside the successes. */
export interface ReferenceUpload {
  uploaded: ReferenceFile[];
  rejected: RejectedFile[];
}

// ------------------------------------------------------- AI task breakdown

export type BreakdownLevel = "epic" | "task" | "subtask";
export type BreakdownStatus = JobStatus | "accepted";

/** Flat node with a string parent ref — the UI nests them for display. */
export interface BreakdownNode {
  id: string;
  parent: string | null;
  level: BreakdownLevel;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  issue_type: string | null;
  /** Leaves only; a node with children carries none. */
  story_points: number | null;
  priority: string | null;
  rationale: string | null;
}

export interface BreakdownDraft {
  nodes: BreakdownNode[];
}

export interface TaskBreakdown {
  id: number;
  project_id: number;
  sprint_id: number | null;
  parent_task_id: number | null;
  parent_task_key: string | null;
  title: string;
  instructions: string | null;
  reference_file_ids: number[];
  reference_filenames: string[];
  status: BreakdownStatus;
  draft: BreakdownDraft | null;
  error: string | null;
  model: string | null;
  created_at: string | null;
  generated_at: string | null;
  accepted_at: string | null;
  created_task_ids: number[];
}

export interface BreakdownCreateIn {
  title?: string | null;
  instructions?: string | null;
  reference_file_ids: number[];
  sprint_id?: number | null;
  parent_task_id?: number | null;
}

export interface BreakdownAcceptIn {
  /** Ancestors of a selected node are pulled in server-side. */
  node_ids: string[];
  sprint_id?: number | null;
}

export interface BreakdownAcceptOut {
  breakdown_id: number;
  created: number;
  task_ids: number[];
  warnings: string[];
}

// ------------------------------------------------------- burndown & velocity

export interface BurndownPoint {
  date: string;
  remaining_points: number;
  completed_points: number;
  total_points: number;
  /** Reconstructed from resolved dates rather than sampled on the day. */
  backfilled: boolean;
}

export interface Burndown {
  sprint_id: number;
  sprint_name: string;
  state: string | null;
  start_date: string | null;
  end_date: string | null;
  /** Frozen at sprint start; the ideal line runs from here to zero. */
  committed_points: number;
  total_points: number;
  completed_points: number;
  remaining_points: number;
  working_days: number;
  /** True when any point was backfilled — scope changes are invisible in those. */
  approximate: boolean;
  points: BurndownPoint[];
}

export interface VelocitySprint {
  sprint_id: number;
  name: string;
  state: string | null;
  end_date: string | null;
  committed_points: number;
  completed_points: number;
  capacity_points: number | null;
}

export interface Velocity {
  sprints: VelocitySprint[];
  /** Closed sprints only — an in-flight sprint is a partial number. */
  average: number;
  rolling3: number;
  closed_count: number;
}

export interface SnapshotOut {
  sprint_id: number;
  written: number;
}

export interface PokerCandidate {
  task_id: number;
  task_key: string | null;
  title: string;
  /** null = in the backlog. */
  sprint_id: number | null;
  sprint_name: string | null;
  /** The number already on the task, when it's an unagreed AI proposal. */
  proposed_points: number | null;
}

/** What a session would queue, split by where the work currently sits. */
export interface PokerCandidates {
  backlog: PokerCandidate[];
  /** Unestimated but already in a sprint and still To Do. */
  in_sprints: PokerCandidate[];
  /** Have points, but only because an AI breakdown proposed them. */
  proposed: PokerCandidate[];
}

// ------------------------------------------------------------- milestones

/** Set by hand. Distinct from the derived `health` below. */
export type MilestoneState = "planned" | "in_progress" | "released" | "cancelled";

/** Derived on read. `unknown` wherever the data can't support a verdict. */
export type MilestoneHealth =
  | "on_track"
  | "at_risk"
  | "overdue"
  | "complete"
  | "unknown";

/**
 * A sprint a milestone has work in. Derived from the milestone's leaf tasks,
 * never stored — so moving a task on the board updates this with no second write.
 */
export interface MilestoneSprintRef {
  sprint_id: number;
  name: string;
  state: string | null;
  start_date: string | null;
  end_date: string | null;
  points_in_milestone: number;
}

export interface Milestone {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  /** Falls back to the earliest linked sprint's start when unset. */
  start_date: string | null;
  target_date: string | null;
  state: MilestoneState;
  rank: number;

  /** Rollup over leaf tasks only — a container's points are its children's. */
  total_points: number;
  completed_points: number;
  remaining_points: number;
  total_tasks: number;
  completed_tasks: number;
  unestimated_tasks: number;
  /** 0..1. Points-based, falling back to the task count when nothing is estimated. */
  progress: number;

  sprints: MilestoneSprintRef[];

  /** null when velocity is 0 or nothing remains — an honest blank, not a guess. */
  forecast_date: string | null;
  /** forecast_date - target_date in days. Negative = ahead of the date. */
  days_late: number | null;
  health: MilestoneHealth;
}

/** A sprint band on the roadmap lane. Only sprints with both dates appear. */
export interface RoadmapSprintBand {
  sprint_id: number;
  name: string;
  state: string | null;
  start_date: string;
  end_date: string;
}

export interface Roadmap {
  milestones: Milestone[];
  sprints: RoadmapSprintBand[];
  range_start: string | null;
  range_end: string | null;
  /** Echoed so the UI can explain the forecast rather than just assert it. */
  velocity_rolling3: number;
  velocity_average: number;
  sprint_length_days: number;
}

export interface MilestoneCreateIn {
  name: string;
  description?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  state?: MilestoneState;
}

/** PATCH — omitted keys are left alone, null clears the field. */
export type MilestonePatchIn = Partial<MilestoneCreateIn> & {
  released_date?: string | null;
  rank?: number;
};

/** One leaf a proposal would claim, and whether it actually can. */
export interface GeneratedTaskRef {
  task_id: number;
  key: string;
  title: string;
  story_points: number | null;
  sprint_name: string | null;
  /** 'skip' means some other milestone already holds it. */
  action: "link" | "skip";
  held_by: string | null;
}

/**
 * A milestone the generator proposes, derived from one top-level epic.
 * `mode: "top_up"` means a previous run already made this milestone and the
 * proposal would only add newly-created leaves to it.
 */
export interface GeneratedMilestone {
  source_task_id: number;
  source_key: string;
  name: string;
  start_date: string | null;
  target_date: string | null;
  sprint_names: string[];
  tasks: GeneratedTaskRef[];
  link_count: number;
  skip_count: number;
  total_points: number;
  mode: "create" | "top_up";
  existing_milestone_id: number | null;
  /** Non-null means it can't be applied; the string says why. */
  conflict: string | null;
}

export interface GeneratePreview {
  strategy: string;
  proposals: GeneratedMilestone[];
  ready_count: number;
  create_count: number;
  top_up_count: number;
  total_link_count: number;
  total_skip_count: number;
}

export interface GenerateResult {
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  milestones: Milestone[];
}

// -------------------------------------------------- epic generation

/** One task a proposed epic would take in. */
export interface EpicMemberRef {
  task_id: number;
  key: string;
  title: string;
  story_points: number | null;
  sprint_name: string | null;
  source: EntitySource;
  action: "group" | "skip";
  reason: string | null;
}

/** A group read out of the team's own PBR/PBI task numbering. */
export interface EpicProposal {
  group_key: string;
  name: string;
  kind: "pbr" | "pbi";
  members: EpicMemberRef[];
  member_count: number;
  skip_count: number;
  total_points: number;
  sprint_names: string[];
  start_date: string | null;
  end_date: string | null;
  mode: "create" | "top_up";
  existing_task_id: number | null;
  conflict: string | null;
}

export interface EpicPreview {
  proposals: EpicProposal[];
  ready_count: number;
  create_count: number;
  top_up_count: number;
  total_member_count: number;
  /** Tasks whose titles carry no recognisable number — shown, never hidden. */
  ungrouped: EpicMemberRef[];
  needs_group_count: number;
  coverage_pct: number;
}

export interface EpicGenerateResult {
  created: number;
  updated: number;
  grouped: number;
  skipped: number;
  epic_task_ids: number[];
}

export interface EpicUngroupResult {
  released: number;
  deleted: boolean;
}

/** A group that can be named: not yet applied, or an epic that already exists. */
export interface NameableGroup {
  group_key: string;
  current_name: string;
  member_count: number;
  /** Set when an epic already exists for this key — a rename, not a create. */
  existing_task_id: number | null;
}

export interface EpicNameables {
  groups: NameableGroup[];
}

/** Suggested names by group_key. Advisory — every one stays editable. */
export interface EpicNames {
  names: Record<string, string>;
  model: string | null;
}

export interface EpicRenameResult {
  renamed: number;
}
