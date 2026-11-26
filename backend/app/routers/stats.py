"""Numbers for the home page: completed videos per shot type across the user's workspace."""

import logging
import re
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends

from ..access import is_member
from ..auth import User, current_user
from ..config import get_settings
from ..deps import Store, get_store
from ..errors import AppError
from ..models import ProgressAccess, ProjectCount, ShotTypeCount, ShotTypeStats
from .videos import belongs_to

router = APIRouter(prefix="/api/stats", tags=["stats"])
log = logging.getLogger(__name__)


def shot_type_key(value: str) -> str:
    return re.sub(r"[\s_-]+", "_", value.strip().lower())


def shot_type_label(value: str) -> str:
    """backhand_cross_clear -> Backhand Cross Clear; answers already written for people stay as they are."""
    value = value.strip()
    if value != value.lower():
        return value
    return " ".join(word.capitalize() for word in re.split(r"[\s_-]+", value) if word)


def in_team(user: User) -> bool:
    """A member of a shared team workspace (everyone counts locally, without sign-in)."""
    return not get_settings().auth_enabled or (user.workspace or "").startswith("team:")


@router.get("/progress", response_model=ProgressAccess)
def progress(user: User = Depends(current_user)):
    """Whether the Progress tab is offered to this user: team members and coaches. (Its numbers are still
    test data in the website for now.)"""
    return ProgressAccess(available=in_team(user) or user.coach)


@router.get("/shot-types", response_model=ShotTypeStats)
def shot_types(user: User = Depends(current_user), store: Store = Depends(get_store)):
    """How many completed videos there are of each shot type, from the stored annotations (never S3): the
    same videos the queues count (current bucket and folder, deleted videos left out)."""
    # Only for team members, counting their team's projects (not coaches or private workspaces, for now).
    if not in_team(user):
        return ShotTypeStats(available=False)

    completed = without = 0
    counts: dict[str, Counter[str]] = defaultdict(Counter)  # shot type -> project id -> videos
    labels: dict[str, str] = {}
    names: dict[str, str] = {}
    for project in store.list_projects():
        field = project.label_schema.shot_type_field()
        if not field or not is_member(user, project):
            continue
        try:
            stored, _ = store.iter_annotations(project.id)
        except AppError as exc:  # one unreadable project must not hide the others
            log.warning("Skipping shot type counts for %s: %s", project.id, exc.message)
            continue
        names[project.id] = project.name
        prefix, removed = project.storage.normalized_prefix, project.removed_keys
        for ann in stored:
            if (
                ann.status != "completed"
                or not belongs_to(ann.bucket, project)
                or not ann.video_key.startswith(prefix)
                or ann.video_key in removed
            ):
                continue
            completed += 1
            value = ann.labels.get(field.key)
            values = [v for v in (value if isinstance(value, list) else [value]) if isinstance(v, str) and v.strip()]
            if not values:
                without += 1
            for v in values:
                key = shot_type_key(v)
                counts[key][project.id] += 1
                labels.setdefault(key, shot_type_label(v))

    rows = [
        ShotTypeCount(
            shot_type=key,
            label=labels[key],
            count=sum(per_project.values()),
            projects=[
                ProjectCount(project_id=pid, project_name=names[pid], count=n) for pid, n in per_project.most_common()
            ],
        )
        for key, per_project in counts.items()
    ]
    rows.sort(key=lambda r: (-r.count, r.label.lower()))
    return ShotTypeStats(available=True, completed=completed, without_shot_type=without, shot_types=rows)
