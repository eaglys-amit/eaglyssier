"""Seed demo data so the full pipeline is verifiable without live credentials.

Creates a project, curated members added to the project, project-scoped identity
mappings (Jira + GitHub accounts mapped to those members), one closed sprint,
tasks with story points and worklogs, a git repo with commits and a PR+review,
and a deliverable. Synced-style rows are attributed via the mapped identities.

Run inside the app container:  python scripts/seed_demo.py
Then open the app, generate a report for the demo sprint, and check the numbers.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    Commit,
    Deliverable,
    GitRepo,
    IntegrationType,
    Member,
    MemberIdentity,
    Project,
    ProjectMember,
    PRReview,
    PullRequest,
    Sprint,
    StatusCategory,
    Task,
)

DEMO_KEY = "DEMO"


def _identity(db, project_id, member, system, external_id, username=None) -> MemberIdentity:
    idn = MemberIdentity(
        project_id=project_id, member_id=member.id, system=system,
        external_id=external_id, username=username,
        email=member.primary_email, display_name=member.display_name,
    )
    db.add(idn)
    db.flush()
    return idn


def main() -> None:
    db = SessionLocal()
    try:
        existing = db.execute(select(Project).where(Project.key == DEMO_KEY)).scalar_one_or_none()
        if existing:
            print(f"Demo project already exists (id={existing.id}). Delete it first to reseed.")
            return

        project = Project(name="Demo Platform", key=DEMO_KEY,
                          description="Seeded demo project for verifying the report pipeline.")
        db.add(project)
        db.flush()

        # curated members
        alice = Member(display_name="Alice Chen", primary_email="alice@demo.dev")
        bob = Member(display_name="Bob Ortiz", primary_email="bob@demo.dev")
        db.add_all([alice, bob])
        db.flush()
        # add them to the project
        db.add_all([
            ProjectMember(project_id=project.id, member_id=alice.id),
            ProjectMember(project_id=project.id, member_id=bob.id),
        ])
        # project-scoped discovered accounts, mapped to the members
        jira_ident = {
            alice.id: _identity(db, project.id, alice, IntegrationType.jira, "jira-alice"),
            bob.id: _identity(db, project.id, bob, IntegrationType.jira, "jira-bob"),
        }
        gh_ident = {
            alice.id: _identity(db, project.id, alice, IntegrationType.github, "alice", "alice"),
            bob.id: _identity(db, project.id, bob, IntegrationType.github, "bortiz", "bortiz"),
        }

        sprint = Sprint(
            project_id=project.id, external_id="1001", name="Sprint 7", state="closed",
            start_date=date(2026, 6, 15), end_date=date(2026, 6, 28),
            complete_date=date(2026, 6, 28), goal="Ship checkout v2 and stabilize sync.",
        )
        db.add(sprint)
        db.flush()

        # tasks: (key, title, type, category, SP, hours, assignee, reopened)
        tasks = [
            ("DEMO-1", "Checkout v2 API", "Story", StatusCategory.done, 8, 12, alice, 0),
            ("DEMO-2", "Payment retry flow", "Story", StatusCategory.done, 5, 7, alice, 1),
            ("DEMO-3", "Cart persistence bug", "Bug", StatusCategory.in_progress, 3, 4, alice, 0),
            ("DEMO-4", "Sprint sync scheduler", "Story", StatusCategory.done, 5, 9, bob, 0),
            ("DEMO-5", "Report PDF export", "Story", StatusCategory.done, 8, 10, bob, 0),
            ("DEMO-6", "Rate-limit handling", "Task", StatusCategory.todo, 2, 0, bob, 0),
            ("DEMO-7", "Untriaged spike", "Spike", StatusCategory.todo, None, 0, None, 0),
        ]
        for key, title, itype, cat, sp, hours, who, reopened in tasks:
            db.add(Task(
                project_id=project.id, sprint_id=sprint.id,
                assignee_identity_id=jira_ident[who.id].id if who else None,
                external_key=key, title=title, issue_type=itype,
                status=cat.value.replace("_", " ").title(), status_category=cat,
                story_points=sp, worklog_seconds=hours * 3600, reopened_count=reopened,
                created_at_src=datetime(2026, 6, 15, tzinfo=timezone.utc),
                resolved_at_src=datetime(2026, 6, 27, tzinfo=timezone.utc) if cat == StatusCategory.done else None,
            ))

        repo = GitRepo(project_id=project.id, provider=IntegrationType.github,
                       external_id="9001", name="demo-org/platform",
                       url="https://github.com/demo-org/platform")
        db.add(repo)
        db.flush()

        base = datetime(2026, 6, 16, tzinfo=timezone.utc)
        commits = [
            (alice, 120, 30, 4, base + timedelta(days=0)),
            (alice, 80, 12, 3, base + timedelta(days=2)),
            (alice, 45, 60, 5, base + timedelta(days=5)),
            (bob, 200, 20, 8, base + timedelta(days=1)),
            (bob, 60, 10, 2, base + timedelta(days=4)),
        ]
        for i, (who, add, dele, files, when) in enumerate(commits):
            db.add(Commit(repo_id=repo.id, author_identity_id=gh_ident[who.id].id, sha=f"demosha{i:04d}",
                          authored_at=when, additions=add, deletions=dele,
                          files_changed=files, message=f"commit {i}"))

        pr = PullRequest(repo_id=repo.id, author_identity_id=gh_ident[alice.id].id, external_id="42",
                         title="Checkout v2", state="merged", additions=245, deletions=102,
                         changed_files=12, created_at_src=base + timedelta(days=3),
                         merged_at_src=base + timedelta(days=6))
        db.add(pr)
        db.flush()
        db.add(PRReview(pr_id=pr.id, reviewer_identity_id=gh_ident[bob.id].id, external_id="r1",
                        state="approved", submitted_at=base + timedelta(days=6)))

        db.add(Deliverable(project_id=project.id, sprint_id=sprint.id,
                           name="Checkout v2 live in production", status="done",
                           description="New checkout API + payment retry deployed.",
                           linked_task_keys=["DEMO-1", "DEMO-2"]))
        db.add(Deliverable(project_id=project.id, sprint_id=sprint.id,
                           name="Automated sprint report export", status="done",
                           linked_task_keys=["DEMO-4", "DEMO-5"]))

        db.commit()
        print(f"Seeded demo project id={project.id}, sprint id={sprint.id}.")
        print("Open /projects, then generate a report for 'Sprint 7'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
