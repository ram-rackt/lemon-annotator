"""Who may open which project.

Every project belongs to a workspace: a team (LEMON_TEAMS) or one person's private workspace. Members
see and change everything in it. A coach (LEMON_COACHES) from another workspace sees only the videos
flagged for coach review: the project's name and labels, the flagged videos, and nothing about its
storage, progress or settings.
"""

import logging

from fastapi import Depends, Request

from .auth import User, current_user, team_workspace
from .config import get_settings
from .deps import Store, get_store
from .errors import NotFoundError
from .models import Project, is_flagged

log = logging.getLogger(__name__)

# Endpoints (by function name) a coach may call on another workspace's project. The ones in
# FLAGGED_ONLY act on one video (?key=), which must be flagged for review right now.
COACH_ENDPOINTS = {
    "get_project",
    "list_videos",
    "activity",
    "review_videos",
    "finish_review",
    "stream_url",
    "get_annotation",
    "save_annotation",
}
FLAGGED_ONLY = {"stream_url", "get_annotation", "save_annotation"}


def is_member(user: User, project: Project) -> bool:
    if not get_settings().auth_enabled:
        return True  # local, single-user setup
    return project.workspace is None or project.workspace == user.workspace


def is_flagged_video(store: Store, project: Project, key: str | None) -> bool:
    """Is this video in the project's coach review list (current bucket and folder, flag set)?"""
    field = project.label_schema.review_field(project.settings.coach_review_field)
    if not field or not key or not key.startswith(project.storage.normalized_prefix):
        return False
    annotation = store.get_annotation(project.id, key)
    return bool(
        annotation
        # Same rule as the queue: annotations saved before buckets were recorded belong to the current one.
        and annotation.bucket in (None, project.storage.bucket)
        and is_flagged(field, annotation.labels.get(field.key))
    )


def project_access(
    project_id: str,
    request: Request,
    user: User = Depends(current_user),
    store: Store = Depends(get_store),
) -> Project:
    """Dependency for every /api/projects/{project_id} endpoint: the project, if this user may use this
    endpoint on it. Anything else is "not found", so other workspaces' projects can't be discovered."""
    project = store.get(project_id)
    if is_member(user, project):
        return project
    endpoint = getattr(request.scope.get("endpoint"), "__name__", "")
    if user.coach and endpoint in COACH_ENDPOINTS:
        if endpoint not in FLAGGED_ONLY or is_flagged_video(store, project, request.query_params.get("key")):
            return project
        raise NotFoundError(
            "This video is no longer flagged for coach review.",
            code="NOT_FLAGGED_FOR_REVIEW",
            hint="Someone may have marked it done. Open Coach review for the current list.",
        )
    raise NotFoundError(f"Project '{project_id}' not found")


def claim_unowned_projects(store: Store) -> int:
    """Give projects made before workspaces existed to the first team in LEMON_TEAMS (once: they keep it
    even if the teams change later). Without teams they stay shared by every signed-in user."""
    settings = get_settings()
    if not settings.auth_enabled or not settings.team_list:
        return 0
    workspace = team_workspace(settings.team_list[0][0])
    claimed = 0
    for project in store.list_projects():
        if project.workspace is not None:
            continue
        with store.lock(project.id):
            fresh = store.get(project.id)
            if fresh.workspace is None:
                fresh.workspace = workspace
                store.save(fresh, touch=False)
                claimed += 1
    if claimed:
        log.info("Moved %d project(s) made before workspaces into %s", claimed, workspace)
    return claimed
