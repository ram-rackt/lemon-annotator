from fastapi import APIRouter, Depends, status

from .. import s3_service
from ..access import is_member, project_access
from ..auth import User, current_user
from ..config import get_settings
from ..deps import Store, get_store, to_coach_view, to_public
from ..errors import ConflictError, ValidationError
from ..models import (
    ConnectionTestResult,
    Project,
    ProjectCreate,
    ProjectPublic,
    ProjectUpdate,
    StorageUpdate,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectPublic])
def list_projects(user: User = Depends(current_user), store: Store = Depends(get_store)):
    """The signed-in user's workspace."""
    return [to_public(p, store) for p in store.list_projects() if is_member(user, p)]


@router.post("", response_model=ProjectPublic, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, user: User = Depends(current_user), store: Store = Depends(get_store)):
    return to_public(store.create(body.name, body.description, workspace=user.workspace), store)


@router.get("/{project_id}", response_model=ProjectPublic)
def get_project(
    project: Project = Depends(project_access),
    user: User = Depends(current_user),
    store: Store = Depends(get_store),
):
    return to_public(project, store) if is_member(user, project) else to_coach_view(project)


# Changes: members only (project_access refuses everyone else).
@router.patch("/{project_id}", response_model=ProjectPublic, dependencies=[Depends(project_access)])
def update_project(project_id: str, body: ProjectUpdate, store: Store = Depends(get_store)):
    with store.lock(project_id):
        project = store.get(project_id)
        if body.name is not None:
            project.name = body.name.strip()
        if body.description is not None:
            project.description = body.description.strip()
        if body.storage is not None:
            before = (project.storage.bucket, project.storage.normalized_prefix)
            new_storage = body.storage.apply_to(project.storage)
            # Annotations are stored per S3 key; mixing two buckets in one project would attach
            # one bucket's labels to same-named videos in the other.
            if project.storage.bucket and new_storage.bucket != project.storage.bucket:
                annotated = sum(1 for e in store.load_index(project_id).values() if e.bucket in (None, project.storage.bucket))
                if annotated:
                    raise ConflictError(
                        f'This project already has {annotated} annotated video{"s" if annotated != 1 else ""} '
                        f'from bucket "{project.storage.bucket}".',
                        code="BUCKET_HAS_ANNOTATIONS",
                        hint="Create a new project for a different bucket (or clear those annotations first).",
                    )
            project.storage = new_storage
            if before != (project.storage.bucket, project.storage.normalized_prefix):
                project.last_sync = None
        if body.label_schema is not None:
            project.label_schema = body.label_schema
        if body.settings is not None:
            # Checked only when it changes, so a field removed from the schema later never blocks saving
            # other settings (the Coach review tab explains that it needs a new field instead).
            review_key = body.settings.coach_review_field
            if review_key and review_key != project.settings.coach_review_field:
                if not project.label_schema.review_field(review_key):
                    raise ValidationError(
                        "The coach review field must be a whole-video checkbox, or a whole-video choice "
                        'with a "true" or "yes" option.',
                        code="INVALID_REVIEW_FIELD",
                    )
            project.settings = body.settings
        store.save(project)
    return to_public(project, store)


@router.delete("/{project_id}", status_code=status.HTTP_200_OK, dependencies=[Depends(project_access)])
def delete_project(project_id: str, user: User = Depends(current_user), store: Store = Depends(get_store)):
    moved_to = store.delete(project_id, by=user.name)
    return {"ok": True, "moved_to": str(moved_to)}


@router.post("/{project_id}/storage/test", response_model=ConnectionTestResult)
def test_storage(body: StorageUpdate | None = None, project: Project = Depends(project_access)):
    """Test the saved settings, or unsaved edits merged over them when a body is sent."""
    cfg = body.apply_to(project.storage) if body else project.storage
    return s3_service.test_connection(cfg, get_settings().max_list_keys)
