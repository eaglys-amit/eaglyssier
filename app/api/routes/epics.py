"""Generate epics by reading the numbering the team already puts in task titles.

A tracker that carries no epics leaves the whole backlog flat, and everything
downstream that expects a hierarchy — the breakdown tree, the milestone
generator — then covers only the handful of trees someone built by hand. See
app.services.epics.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db import get_db
from app.models import Project
from app.schemas.epic import (
    EpicGenerateIn,
    EpicGenerateOut,
    EpicNameablesOut,
    EpicNamesOut,
    EpicPreviewOut,
    EpicRenameIn,
    EpicRenameOut,
    EpicUngroupOut,
    NameableGroup,
)
from app.services import epics as epic_svc

router = APIRouter()


@router.get("/projects/{project_id}/epics/generate/preview", response_model=EpicPreviewOut)
def preview_epics(project_id: int, db: Session = Depends(get_db)):
    """Dry run: the groups, their members, and what could not be placed.

    `coverage_pct` and `ungrouped` are part of the contract, not decoration —
    a generator that quietly handles most of a backlog is indistinguishable
    from a broken one.
    """
    get_or_404(db, Project, project_id)
    return epic_svc.preview_epics(db, project_id)


@router.get("/projects/{project_id}/epics/nameable", response_model=EpicNameablesOut)
def nameable_groups(project_id: int, db: Session = Depends(get_db)):
    """Every group that can be named — pending ones and epics already created."""
    get_or_404(db, Project, project_id)
    return EpicNameablesOut(
        groups=[
            NameableGroup(
                group_key=key,
                current_name=current,
                member_count=len(titles),
                existing_task_id=task_id,
            )
            for key, current, titles, task_id in epic_svc.nameable_groups(db, project_id)
        ]
    )


@router.post("/projects/{project_id}/epics/generate/names", response_model=EpicNamesOut)
def suggest_epic_names(project_id: int, db: Session = Depends(get_db)):
    """Suggest a readable name per group, from its task titles.

    Naming only — the grouping is already decided and is not sent for review, so
    an unavailable or wrong model costs a worse label, never a wrong epic. Runs
    inline rather than as a background job: it is one call for every group, and
    the user is sitting in front of the dialog waiting for it.

    409 when the project has no analysis provider; 502 when the model fails.
    Either way the dialog keeps its derived names and stays usable.
    """
    get_or_404(db, Project, project_id)
    return EpicNamesOut(names=epic_svc.suggest_names(db, project_id))


@router.post("/projects/{project_id}/epics/rename", response_model=EpicRenameOut)
def rename_epics(project_id: int, body: EpicRenameIn, db: Session = Depends(get_db)):
    """Retitle epics a previous run created, by group key.

    Separate from generate because the common case is a project where every
    group was already applied — there is nothing left to create, only names to
    fix.
    """
    get_or_404(db, Project, project_id)
    return EpicRenameOut(renamed=epic_svc.rename_epics(db, project_id, body.names))


@router.post("/projects/{project_id}/epics/generate", response_model=EpicGenerateOut)
def generate_epics(project_id: int, body: EpicGenerateIn, db: Session = Depends(get_db)):
    """Create the epics and move their members under them.

    The move is real — these are the original tasks re-parented, not copies —
    and it survives the next sync, because the connector never writes
    `parent_id`. Undo with the ungroup endpoint below.
    """
    get_or_404(db, Project, project_id)
    return epic_svc.generate_epics(db, project_id, body.group_keys, body.names)


@router.delete("/projects/{project_id}/epics/{task_id}/ungroup", response_model=EpicUngroupOut)
def ungroup_epic(project_id: int, task_id: int, db: Session = Depends(get_db)):
    """Undo one generated epic: release its children, delete the container.

    409s on an epic this service did not create — a hand-made or AI-drafted one
    is somebody's work.
    """
    get_or_404(db, Project, project_id)
    return epic_svc.ungroup_epic(db, project_id, task_id)
