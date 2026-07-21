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
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
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

    project: Mapped["Project"] = relationship(back_populates="sprints")
    tasks: Mapped[list["Task"]] = relationship(back_populates="sprint")
    member_capacities: Mapped[list["SprintMemberCapacity"]] = relationship(
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


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("project_id", "external_key", name="uq_task_project_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    sprint_id: Mapped[int | None] = mapped_column(ForeignKey("sprints.id", ondelete="SET NULL"))
    assignee_identity_id: Mapped[int | None] = mapped_column(
        ForeignKey("member_identities.id", ondelete="SET NULL")
    )
    external_key: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g. ABC-123
    issue_type: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(String(64))
    status_category: Mapped[StatusCategory] = mapped_column(
        Enum(StatusCategory), default=StatusCategory.todo
    )
    story_points: Mapped[float | None] = mapped_column(Float)
    worklog_seconds: Mapped[int] = mapped_column(Integer, default=0)  # working-hours source
    reopened_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # first -> in progress
    resolved_at_src: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship(back_populates="tasks")
    sprint: Mapped["Sprint"] = relationship(back_populates="tasks")
    assignee: Mapped["MemberIdentity"] = relationship()


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

    repo: Mapped["GitRepo"] = relationship(back_populates="commits")
    author: Mapped["MemberIdentity"] = relationship()


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
