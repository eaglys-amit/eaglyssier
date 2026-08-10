"""Core domain models: projects, integrations, members, sprints, tasks, git, reports."""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class IntegrationType(str, enum.Enum):
    jira = "jira"
    github = "github"
    gitlab = "gitlab"
    slack = "slack"       # stubbed in iteration 1
    google = "google"     # stubbed in iteration 1


class StatusCategory(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class SyncStatus(str, enum.Enum):
    running = "running"
    success = "success"
    failed = "failed"


class ReportStatus(str, enum.Enum):
    pending = "pending"
    generating = "generating"
    ready = "ready"
    failed = "failed"


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    key: Mapped[str | None] = mapped_column(String(64), unique=True)  # short slug
    description: Mapped[str | None] = mapped_column(Text)
    # LLM provider used for per-commit code analysis (see app.services.analyzers).
    analysis_provider: Mapped[str] = mapped_column(
        String(32), nullable=False, default="claude_cli", server_default="claude_cli"
    )
    # Optional model override for the provider (e.g. "opus"/"sonnet"/"haiku" for
    # the Claude CLI). NULL/empty = provider default.
    analysis_model: Mapped[str | None] = mapped_column(String(64))
    # LLM-generated deliverables state (see app.services.deliverables).
    deliverables_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )  # none | running | ready | failed
    deliverables_error: Mapped[str | None] = mapped_column(Text)
    deliverables_model: Mapped[str | None] = mapped_column(String(128))
    deliverables_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Persisted analysis scope for KPI/Evaluation generation (see app.services.scope):
    # {"member_ids": [], "sprint_ids": [], "repo_ids": [], "start_date": null, "end_date": null}
    analysis_scope: Mapped[dict | None] = mapped_column(JSON)

    integrations: Mapped[list["Integration"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    sprints: Mapped[list["Sprint"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    repos: Mapped[list["GitRepo"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    deliverables: Mapped[list["Deliverable"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    story_point_scale: Mapped[list["StoryPointScale"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Integration(Base, TimestampMixin):
    __tablename__ = "integrations"
    __table_args__ = (UniqueConstraint("project_id", "type", name="uq_integration_project_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    type: Mapped[IntegrationType] = mapped_column(Enum(IntegrationType), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(512))
    # Fernet-encrypted secret token/blob (see app.services.crypto)
    credentials_enc: Mapped[str | None] = mapped_column(Text)
    # Non-secret config: e.g. {"jira_project_key": "ABC", "board_id": 12} or {"repos": [...]}
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    project: Mapped["Project"] = relationship(back_populates="integrations")


class Member(Base, TimestampMixin):
    """A curated person, created by hand in the UI (never auto-created by sync)."""

    __tablename__ = "members"

    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    primary_email: Mapped[str | None] = mapped_column(String(320), index=True)

    # Project-scoped external accounts mapped to this member. member_id is
    # SET NULL on delete, so identities are unmapped (not deleted) when a member
    # is removed -> no cascade delete-orphan here.
    identities: Mapped[list["MemberIdentity"]] = relationship(back_populates="member")
    project_links: Mapped[list["ProjectMember"]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )


class ProjectMember(Base, TimestampMixin):
    """Membership of a global Member in a project (selected in the project UI)."""

    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "member_id", name="uq_project_member"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))

    # Per-member analysis data selection chosen on the Data tab (see
    # app.services.scope): {"sprint_ids": [], "repo_ids": [], "start_date":
    # null, "end_date": null}. KPI/Evaluation generation for this member reads it.
    analysis_scope: Mapped[dict | None] = mapped_column(JSON)

    # LLM-generated KPI from this member's commits + Jira tasks (see app.services.kpi).
    kpi_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )  # none | running | ready | failed
    kpi: Mapped[dict | None] = mapped_column(JSON)  # hard metrics + AI assessment
    kpi_error: Mapped[str | None] = mapped_column(Text)
    kpi_model: Mapped[str | None] = mapped_column(String(128))
    kpi_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship(back_populates="members")
    member: Mapped["Member"] = relationship(back_populates="project_links")


class EvaluationSheet(Base, TimestampMixin):
    """Per-project, per-member MBO FORM② evaluation sheet (see app.services.evaluation).

    `axes` maps each of the 6 axis keys (outcomes/value/cost/quality/delivery/
    ownership) to {planned_goal, key_results, self_eval, tech_lead_eval,
    final_eval} where grades are "S".."E" or None. `checklist` stores the
    normalized 16-item PASS/FAIL result of the HR FORM② checker prompt.
    """

    __tablename__ = "evaluation_sheets"
    __table_args__ = (
        UniqueConstraint("project_id", "member_id", name="uq_eval_project_member"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))

    tech_lead_name: Mapped[str | None] = mapped_column(String(255))
    axes: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence: Mapped[str | None] = mapped_column(Text)  # Evidence of Outcomes (URLs/refs)

    # One background LLM job at a time per sheet.
    job_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )  # none | running | ready | failed
    job_kind: Mapped[str | None] = mapped_column(String(16))  # goals | results | checklist
    job_error: Mapped[str | None] = mapped_column(Text)
    job_model: Mapped[str | None] = mapped_column(String(128))
    goals_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    results_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checklist: Mapped[dict | None] = mapped_column(JSON)

    project: Mapped["Project"] = relationship()
    member: Mapped["Member"] = relationship()


class MemberIdentity(Base, TimestampMixin):
    """A project-scoped external account (jira/github/gitlab) discovered in sync.

    One row per external account seen in a project's synced data. `member_id` is
    the curated Member it's mapped to, or NULL when discovered-but-unmapped.
    Synced rows (task assignee, commit/PR author, review reviewer) reference this
    identity, so mapping/remapping an account re-attributes all history via the join.
    """

    __tablename__ = "member_identities"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "system", "external_id", name="uq_identity_project_system_external"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    member_id: Mapped[int | None] = mapped_column(ForeignKey("members.id", ondelete="SET NULL"))
    system: Mapped[IntegrationType] = mapped_column(Enum(IntegrationType), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320), index=True)
    display_name: Mapped[str | None] = mapped_column(String(255))

    project: Mapped["Project"] = relationship()
    member: Mapped["Member"] = relationship(back_populates="identities")


class Sprint(Base, TimestampMixin):
    __tablename__ = "sprints"
    __table_args__ = (
        UniqueConstraint("project_id", "external_id", name="uq_sprint_project_external"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # NULL for locally-created sprints. Postgres treats NULLs as distinct in a
    # UNIQUE constraint, so any number of local sprints coexist and the
    # constraint above keeps deduplicating synced ones.
    external_id: Mapped[str | None] = mapped_column(String(64))
    # 'sync'  = owned by a connector; _upsert_sprint may overwrite it.
    # 'local' = created in the Scrums tab; sync must never touch it.
    # The Python default is 'local' so an insert that forgets to set it can
    # never be clobbered by a sync; server_default backfills existing rows.
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="local", server_default="sync"
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[str | None] = mapped_column(String(32))  # active/closed/future
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    complete_date: Mapped[date | None] = mapped_column(Date)
    goal: Mapped[str | None] = mapped_column(Text)
    # Manual capacity-days override for focus-factor allocation (see
    # app.services.capacity). NULL = fall back to business days between
    # start_date/end_date.
    working_days: Mapped[int | None] = mapped_column(Integer)
    # Story points committed when the sprint started, stamped by
    # POST /sprints/{id}/start. NULL = derive the burndown baseline from the
    # first snapshot instead.
    committed_points: Mapped[float | None] = mapped_column(Float)

    project: Mapped["Project"] = relationship(back_populates="sprints")
    tasks: Mapped[list["Task"]] = relationship(back_populates="sprint")
    member_capacities: Mapped[list["SprintMemberCapacity"]] = relationship(
        back_populates="sprint", cascade="all, delete-orphan"
    )
    snapshots: Mapped[list["SprintSnapshot"]] = relationship(
        back_populates="sprint", cascade="all, delete-orphan"
    )


class SprintMemberCapacity(Base, TimestampMixin):
    """A member's focus factor for one sprint (see app.services.capacity).

    Allocated story points = focus_factor * the sprint's working days (1 day =
    1 point). Keyed on the global Member id, matching how KPI/scope reference
    members.
    """

    __tablename__ = "sprint_member_capacity"
    __table_args__ = (
        UniqueConstraint("sprint_id", "member_id", name="uq_sprint_member_capacity"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sprint_id: Mapped[int] = mapped_column(ForeignKey("sprints.id", ondelete="CASCADE"))
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))
    focus_factor: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    sprint: Mapped["Sprint"] = relationship(back_populates="member_capacities")
    member: Mapped["Member"] = relationship()


class Milestone(Base, TimestampMixin):
    """A dated goal above the sprint horizon — a release, a launch, a gate.

    Owns no numbers of its own. Progress is a leaf-only story-point rollup of
    the tasks pointing at it (Task.milestone_id), and the sprints a milestone
    spans are *derived* from those tasks rather than stored — so moving a task
    between sprints on the board keeps the roadmap honest without a second
    write. See app.services.milestones.

    No `source` column, unlike Sprint/Task: no connector owns milestones, they
    are always created here, and so sync_scoped() does not apply.
    """

    __tablename__ = "milestones"
    __table_args__ = (Index("ix_milestone_project_id", "project_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # The roadmap bar's left edge. NULL falls back to the earliest linked
    # sprint's start, so a bar always has somewhere to begin.
    start_date: Mapped[date | None] = mapped_column(Date)
    # The date the forecast is judged against, and the diamond on the bar.
    target_date: Mapped[date | None] = mapped_column(Date)
    # planned | in_progress | released | cancelled. Set by hand; distinct from
    # the derived `health`, which the service computes from points and velocity.
    state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="planned", server_default="planned"
    )
    released_date: Mapped[date | None] = mapped_column(Date)
    # Roadmap row order, sparse like Task.rank (see tasks_svc.RANK_STEP).
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    project: Mapped["Project"] = relationship()
    tasks: Mapped[list["Task"]] = relationship(back_populates="milestone")


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("project_id", "external_key", name="uq_task_project_key"),
        Index("ix_task_parent_id", "parent_id"),
        Index("ix_task_milestone_id", "milestone_id"),
        Index("ix_task_project_sprint_rank", "project_id", "sprint_id", "rank"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    sprint_id: Mapped[int | None] = mapped_column(ForeignKey("sprints.id", ondelete="SET NULL"))
    # The milestone this work counts toward. SET NULL like sprint_id: deleting
    # a milestone releases its tasks rather than destroying them.
    #
    # _upsert_task in app.services.sync assigns an explicit field list that
    # does not include this column, so a Jira re-sync preserves the link on a
    # source='sync' task. Keep it that way.
    milestone_id: Mapped[int | None] = mapped_column(
        ForeignKey("milestones.id", ondelete="SET NULL")
    )
    assignee_identity_id: Mapped[int | None] = mapped_column(
        ForeignKey("member_identities.id", ondelete="SET NULL")
    )
    # NULL for locally-created tasks — see the note on Sprint.external_id.
    external_key: Mapped[str | None] = mapped_column(String(64))  # e.g. ABC-123
    # 'sync' | 'local'. See Sprint.source; the same rules apply, and
    # app.services.tasks.sync_scoped is the shared guard.
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="local", server_default="sync"
    )
    # Breakdown tree parent (epic -> task -> subtask). SET NULL rather than
    # CASCADE: deleting a container promotes its children to top level instead
    # of silently destroying work, matching sprint_id/assignee_identity_id.
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    # Sparse manual ordering for the backlog board (step 1000, renumbered on
    # collision). Ranking is per project; filtering by sprint_id and then
    # ordering by rank also gives the correct within-sprint order.
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    priority: Mapped[str | None] = mapped_column(String(16))  # highest|high|medium|low|lowest
    acceptance_criteria: Mapped[str | None] = mapped_column(Text)
    issue_type: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(String(64))
    status_category: Mapped[StatusCategory] = mapped_column(
        Enum(StatusCategory), default=StatusCategory.todo
    )
    story_points: Mapped[float | None] = mapped_column(Float)
    # Where story_points came from. NULL for connector-synced estimates.
    #   ai     = proposed by an AI breakdown, not yet agreed by the team
    #   poker  = agreed in a planning-poker round
    #   manual = typed in by a person
    # Poker uses this to offer "re-estimate the AI's proposals" as its own
    # scope: without it, a proposed number is indistinguishable from a settled
    # one and the room never gets to challenge the model.
    estimate_source: Mapped[str | None] = mapped_column(String(16))
    worklog_seconds: Mapped[int] = mapped_column(Integer, default=0)  # working-hours source
    reopened_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # first -> in progress
    resolved_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship(back_populates="tasks")
    sprint: Mapped["Sprint"] = relationship(back_populates="tasks")
    milestone: Mapped["Milestone | None"] = relationship(back_populates="tasks")
    assignee: Mapped["MemberIdentity"] = relationship()
    parent: Mapped["Task | None"] = relationship(
        back_populates="children", remote_side="Task.id"
    )
    children: Mapped[list["Task"]] = relationship(back_populates="parent")


class GitRepo(Base, TimestampMixin):
    __tablename__ = "git_repos"
    __table_args__ = (
        UniqueConstraint("project_id", "provider", "external_id", name="uq_repo_provider_external"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    provider: Mapped[IntegrationType] = mapped_column(Enum(IntegrationType), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str | None] = mapped_column(String(512))

    # Per-repo git data sync state (see app.services.sync.sync_repo).
    sync_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="idle", server_default="idle"
    )  # idle | running | done | failed
    sync_error: Mapped[str | None] = mapped_column(Text)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # LLM-generated repository overview (see app.services.repo_summary).
    summary_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )  # none | running | ready | failed
    summary: Mapped[dict | None] = mapped_column(JSON)
    summary_error: Mapped[str | None] = mapped_column(Text)
    summary_model: Mapped[str | None] = mapped_column(String(128))
    summarized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship(back_populates="repos")
    commits: Mapped[list["Commit"]] = relationship(
        back_populates="repo", cascade="all, delete-orphan"
    )
    pull_requests: Mapped[list["PullRequest"]] = relationship(
        back_populates="repo", cascade="all, delete-orphan"
    )


class Commit(Base, TimestampMixin):
    __tablename__ = "commits"
    __table_args__ = (UniqueConstraint("repo_id", "sha", name="uq_commit_repo_sha"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    repo_id: Mapped[int] = mapped_column(ForeignKey("git_repos.id", ondelete="CASCADE"))
    author_identity_id: Mapped[int | None] = mapped_column(
        ForeignKey("member_identities.id", ondelete="SET NULL")
    )
    sha: Mapped[str] = mapped_column(String(64), nullable=False)
    authored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    additions: Mapped[int] = mapped_column(Integer, default=0)
    deletions: Mapped[int] = mapped_column(Integer, default=0)
    files_changed: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)
    # 2+ parents (PR merge / branch update) — excluded from KPI/Evaluation metrics.
    is_merge: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # LLM code analysis of this commit's diff (see app.services.commit_analysis).
    analysis_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )  # none | running | ready | failed
    analysis: Mapped[dict | None] = mapped_column(JSON)  # parsed structured result
    analysis_error: Mapped[str | None] = mapped_column(Text)
    analysis_model: Mapped[str | None] = mapped_column(String(128))
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # LLM attribution of this commit to a Jira task, scoped to the sprint that
    # contains authored_at and matched against task titles/descriptions (see
    # app.services.commit_link). linked_task_id NULL after a 'ready' run means
    # "no matching task in that sprint".
    linked_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL")
    )
    link_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )  # none | running | ready | failed
    link_error: Mapped[str | None] = mapped_column(Text)
    link_reason: Mapped[str | None] = mapped_column(Text)  # LLM rationale for the match

    repo: Mapped["GitRepo"] = relationship(back_populates="commits")
    author: Mapped["MemberIdentity"] = relationship()
    linked_task: Mapped["Task"] = relationship()


class PullRequest(Base, TimestampMixin):
    __tablename__ = "pull_requests"
    __table_args__ = (
        UniqueConstraint("repo_id", "external_id", name="uq_pr_repo_external"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    repo_id: Mapped[int] = mapped_column(ForeignKey("git_repos.id", ondelete="CASCADE"))
    author_identity_id: Mapped[int | None] = mapped_column(
        ForeignKey("member_identities.id", ondelete="SET NULL")
    )
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)  # PR/MR number
    title: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(String(32))  # open/merged/closed
    additions: Mapped[int] = mapped_column(Integer, default=0)
    deletions: Mapped[int] = mapped_column(Integer, default=0)
    changed_files: Mapped[int] = mapped_column(Integer, default=0)
    created_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    merged_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    repo: Mapped["GitRepo"] = relationship(back_populates="pull_requests")
    author: Mapped["MemberIdentity"] = relationship()
    reviews: Mapped[list["PRReview"]] = relationship(
        back_populates="pull_request", cascade="all, delete-orphan"
    )


class PRReview(Base, TimestampMixin):
    __tablename__ = "pr_reviews"
    __table_args__ = (
        UniqueConstraint("pr_id", "external_id", name="uq_review_pr_external"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    pr_id: Mapped[int] = mapped_column(ForeignKey("pull_requests.id", ondelete="CASCADE"))
    reviewer_identity_id: Mapped[int | None] = mapped_column(
        ForeignKey("member_identities.id", ondelete="SET NULL")
    )
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    state: Mapped[str | None] = mapped_column(String(32))  # approved/changes_requested/commented
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    pull_request: Mapped["PullRequest"] = relationship(back_populates="reviews")
    reviewer: Mapped["MemberIdentity"] = relationship()


class Deliverable(Base, TimestampMixin):
    __tablename__ = "deliverables"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    sprint_id: Mapped[int | None] = mapped_column(ForeignKey("sprints.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="done")
    linked_task_keys: Mapped[list] = mapped_column(JSON, default=list)
    # "ai" = LLM-generated (replaced on regenerate); "manual" = hand/seed-created (kept).
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="manual", server_default="manual"
    )

    project: Mapped["Project"] = relationship(back_populates="deliverables")
    sprint: Mapped["Sprint"] = relationship()


class Report(Base, TimestampMixin):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    report_type: Mapped[str] = mapped_column(String(32), default="sprint")  # sprint|project
    scope: Mapped[dict] = mapped_column(JSON, default=dict)  # {"sprint_id": 1} or date range
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[ReportStatus] = mapped_column(Enum(ReportStatus), default=ReportStatus.pending)
    html_key: Mapped[str | None] = mapped_column(String(512))  # RustFS object key
    pdf_key: Mapped[str | None] = mapped_column(String(512))
    error: Mapped[str | None] = mapped_column(Text)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship()


class StoryPointScale(Base, TimestampMixin):
    """Per-project story-point reference scale (points -> time band + risk).

    Used as estimation guidance and to flag tasks whose logged hours fall
    outside the band for their points.
    """

    __tablename__ = "story_point_scale"
    __table_args__ = (
        UniqueConstraint("project_id", "points", name="uq_scale_project_points"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    min_hours: Mapped[float | None] = mapped_column(Float)
    max_hours: Mapped[float | None] = mapped_column(Float)
    risk: Mapped[str] = mapped_column(String(32), default="None")
    needs_breakdown: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(String(255))

    project: Mapped["Project"] = relationship(back_populates="story_point_scale")


class SyncRun(Base, TimestampMixin):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    integration_id: Mapped[int] = mapped_column(
        ForeignKey("integrations.id", ondelete="CASCADE")
    )
    status: Mapped[SyncStatus] = mapped_column(Enum(SyncStatus), default=SyncStatus.running)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)

    integration: Mapped["Integration"] = relationship()


class PokerSession(Base, TimestampMixin):
    """A planning-poker session: an ordered set of tasks to estimate together.

    DB-backed with 2s frontend polling rather than websockets — this app has no
    broadcast layer, and a poker round changes state a handful of times per
    minute. Participants self-identify by picking a Member, because there is no
    auth; votes are therefore advisory, which is fine for a team in a room.
    """

    __tablename__ = "poker_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # SET NULL: a session may outlive the sprint it was planning for.
    sprint_id: Mapped[int | None] = mapped_column(ForeignKey("sprints.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="open", server_default="open"
    )  # open | closed
    # Whoever started the session. Only they may reveal, so one early click
    # can't turn the cards over while the room is still thinking. SET NULL so a
    # deleted member doesn't leave a session nobody can ever reveal — it falls
    # back to open reveal instead.
    facilitator_member_id: Mapped[int | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL")
    )
    # Deck snapshotted from StoryPointScale at creation, so editing the project
    # scale mid-session can't change the cards under the players.
    deck: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Values the scale flagged needs_breakdown when the deck was taken.
    breakdown_points: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship()
    sprint: Mapped["Sprint"] = relationship()
    facilitator: Mapped["Member"] = relationship()
    rounds: Mapped[list["PokerRound"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class PokerRound(Base, TimestampMixin):
    """One task's estimation round. `attempt` allows a re-vote after discussion."""

    __tablename__ = "poker_rounds"
    __table_args__ = (
        UniqueConstraint("session_id", "task_id", "attempt", name="uq_poker_round_task_attempt"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("poker_sessions.id", ondelete="CASCADE")
    )
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # voting   -> vote values are withheld from the API payload
    # revealed -> values visible; applied -> written to Task.story_points
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="voting", server_default="voting"
    )  # voting | revealed | applied | skipped
    final_points: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(Text)  # what the discussion settled
    revealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    session: Mapped["PokerSession"] = relationship(back_populates="rounds")
    task: Mapped["Task"] = relationship()
    votes: Mapped[list["PokerVote"]] = relationship(
        back_populates="round", cascade="all, delete-orphan"
    )


class PokerVote(Base, TimestampMixin):
    """One member's card for one round.

    Upserted on (round, member): changing your mind before the reveal replaces
    the card rather than adding a second one.
    """

    __tablename__ = "poker_votes"
    __table_args__ = (
        UniqueConstraint("round_id", "member_id", name="uq_poker_vote_round_member"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("poker_rounds.id", ondelete="CASCADE"))
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))
    points: Mapped[float | None] = mapped_column(Float)  # NULL when abstaining
    # The "?" card: I don't know enough to estimate this. Distinct from not
    # having voted, and it must not drag the consensus toward zero.
    abstain: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    round: Mapped["PokerRound"] = relationship(back_populates="votes")
    member: Mapped["Member"] = relationship()


class ReferenceFolder(Base, TimestampMixin):
    """A folder in the project's reference document tree.

    An adjacency list, like Task.parent_id: one self-FK gives arbitrary depth
    with no closure table to keep in sync. Document trees here are a handful of
    levels at most, so the whole set is read in one query and assembled in
    Python rather than with a recursive CTE.

    The two delete rules differ on purpose. ``parent_id`` CASCADEs, so deleting
    a folder takes its subfolders with it — an empty shell of child folders
    would be worse than nothing. But ``ReferenceFile.folder_id`` is SET NULL, so
    the documents themselves survive at the project root: filing is
    organizational, and losing a spec because someone tidied up would be
    unrecoverable once the blob is gone. Re-filing a document is merely a
    nuisance.

    Sibling names are kept unique case-insensitively by
    app.services.references.  Not a UniqueConstraint, because Postgres treats
    NULLs as distinct and every top-level folder has parent_id IS NULL, so the
    constraint would silently not apply exactly where it is needed most.
    """

    __tablename__ = "reference_folders"
    __table_args__ = (
        Index("ix_reference_folder_project_id", "project_id"),
        Index("ix_reference_folder_parent_id", "parent_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # NULL = a top-level folder, directly under the project root.
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("reference_folders.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    project: Mapped["Project"] = relationship()


class ReferenceFile(Base, TimestampMixin):
    """An uploaded reference document (md/txt/html/pdf) stored in RustFS.

    Feeds AI task breakdown: ``extracted_text`` is the plain text handed to the
    model, so the bytes only ever need to come back for a human download. They
    live in object storage under ``references/{project_id}/{id}/{filename}``,
    mirroring how report artifacts are keyed.
    """

    __tablename__ = "reference_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # Optional attachment point. SET NULL so deleting a task keeps the document —
    # a spec usually outlives whichever ticket first referenced it.
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    # Where the document is filed. NULL = the project root, which is also what
    # every document uploaded before folders existed keeps. SET NULL for the
    # reason spelled out on ReferenceFolder: tidying up must not destroy bytes.
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("reference_folders.id", ondelete="SET NULL"), index=True
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # md | txt | html | pdf
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Extraction runs inline on upload (fast enough under the size cap), but the
    # status columns still exist so the UI can show "no text extractable" and
    # offer a retry — the observability of a job without the polling latency.
    extract_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )  # none | running | ready | failed
    extract_error: Mapped[str | None] = mapped_column(Text)

    project: Mapped["Project"] = relationship()
    task: Mapped["Task"] = relationship()
    folder: Mapped["ReferenceFolder"] = relationship()


class TaskBreakdown(Base, TimestampMixin):
    """An AI-drafted epic/task/subtask tree, staged before the user accepts it.

    The whole tree lives in the ``draft`` JSON column as a flat node list with
    string parent refs. Per-node rows would need their own parent/rank plumbing
    and CRUD to model something the user edits as one form and accepts
    atomically — and every other LLM result here is already staged as a JSON
    blob on an owning row (Commit.analysis, GitRepo.summary, ProjectMember.kpi,
    EvaluationSheet.axes).

    ``reference_file_ids`` is deliberately a plain id list, not a FK table:
    deleting a document afterwards shouldn't invalidate the provenance of a
    draft that was already accepted.
    """

    __tablename__ = "task_breakdowns"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    sprint_id: Mapped[int | None] = mapped_column(ForeignKey("sprints.id", ondelete="SET NULL"))
    # When set, accepted nodes are parented under this task instead of being
    # created at top level — "break this epic down" rather than "plan this doc".
    parent_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    instructions: Mapped[str | None] = mapped_column(Text)
    reference_file_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )  # none | running | ready | failed | accepted
    draft: Mapped[dict | None] = mapped_column(JSON)  # {"nodes": [...]}
    error: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(128))
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_task_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    project: Mapped["Project"] = relationship()
    sprint: Mapped["Sprint"] = relationship()
    parent_task: Mapped["Task"] = relationship()


class SprintSnapshot(Base, TimestampMixin):
    """One day's reading of a sprint's scope, for the burndown chart.

    Burndown can't be reconstructed from current state — you need what remained
    on each day — so it has to be sampled. Upserted both by the daily scheduler
    job and on every burndown read, so a dev instance with the scheduler off
    still accumulates history.
    """

    __tablename__ = "sprint_snapshots"
    __table_args__ = (
        UniqueConstraint("sprint_id", "snapshot_date", name="uq_sprint_snapshot_day"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sprint_id: Mapped[int] = mapped_column(ForeignKey("sprints.id", ondelete="CASCADE"))
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_points: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default="0"
    )
    remaining_points: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default="0"
    )
    completed_points: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default="0"
    )
    total_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    completed_tasks: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # True when this row was reconstructed after the fact rather than sampled on
    # the day. Scope changes can't be recovered that way, so the UI says so.
    backfilled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    sprint: Mapped["Sprint"] = relationship(back_populates="snapshots")
