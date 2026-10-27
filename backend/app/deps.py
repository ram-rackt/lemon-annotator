from functools import lru_cache

from .config import get_settings
from .db_store import DatabaseStore
from .models import ProgressStats, Project, ProjectPublic, StoragePublic
from .storage import ProjectStore

# Both stores expose the same methods; which one is used depends on LEMON_DATABASE_URL.
Store = ProjectStore | DatabaseStore


@lru_cache
def get_store() -> Store:
    settings = get_settings()
    if settings.database_url:
        return DatabaseStore(settings.database_url)
    return ProjectStore(settings.data_dir)


def to_public(project: Project, store: Store) -> ProjectPublic:
    return ProjectPublic(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        updated_at=project.updated_at,
        storage=StoragePublic.from_config(project.storage),
        label_schema=project.label_schema,
        settings=project.settings,
        last_sync=project.last_sync,
        stats=store.stats(project),
    )


def to_coach_view(project: Project) -> ProjectPublic:
    """A coach from another workspace: enough to review its flagged videos (name, labels, player
    settings), but nothing about its storage, progress or other videos."""
    return ProjectPublic(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        updated_at=project.updated_at,
        storage=StoragePublic(
            access_key_id="",
            has_secret_access_key=False,
            has_session_token=False,
            region="",
            bucket="",
            prefix="",
            endpoint_url="",
            is_configured=project.storage.is_configured,
        ),
        label_schema=project.label_schema,
        settings=project.settings,
        last_sync=None,
        stats=ProgressStats(),
        access="coach",
    )
