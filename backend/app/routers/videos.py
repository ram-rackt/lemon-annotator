import logging
import math
import posixpath
import secrets
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query

from .. import presence, s3_service
from ..access import is_member, project_access
from ..auth import User, current_user
from ..config import get_settings
from ..deps import Store, get_store, to_public
from ..errors import AppError, ConflictError, NotFoundError, S3Error, StorageError, ValidationError
from ..models import (
    ActivityPing,
    ActivityResult,
    AnnotationSave,
    BatchResult,
    ClearResult,
    KeyBatch,
    Project,
    ProjectPublic,
    ProjectReview,
    RemovedVideo,
    ReviewList,
    ReviewVideo,
    SchemaField,
    SkippedVideo,
    SyncedList,
    SyncedVideo,
    StreamUrl,
    SyncInfo,
    VideoAnnotation,
    VideoBatch,
    VideoDetails,
    VideoItem,
    VideoList,
    VideoState,
    cleared_value,
    is_flagged,
    utcnow,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["videos"])
# Coach review across every project (the dashboard's Coach review tab).
review_router = APIRouter(prefix="/api/review", tags=["review"])
log = logging.getLogger(__name__)


def require_video_key(project: Project, key: str, *, inside_prefix: bool = True) -> None:
    """Only presign / annotate .mp4 and .mov objects inside this project's folder."""
    if not s3_service.is_video_key(key):
        raise ValidationError("Only .mp4 and .mov videos are supported.", code="UNSUPPORTED_VIDEO")
    prefix = project.storage.normalized_prefix
    if inside_prefix and prefix and not key.startswith(prefix):
        raise ValidationError(f"{key!r} is outside this project's folder ({prefix}).", code="KEY_OUTSIDE_PREFIX")


def belongs_to(entry_bucket: str | None, project: Project) -> bool:
    """Annotations saved before buckets were recorded (None) belong to the current bucket."""
    return entry_bucket in (None, project.storage.bucket)


@router.get("/videos", response_model=VideoList)
def list_videos(
    user: User = Depends(current_user),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    """The video queue: the videos found by the latest sync, with their annotations. The bucket itself
    isn't listed here; only a sync someone asks for does that (see sync_storage)."""
    if not is_member(user, project):
        return flagged_queue(project, store)
    return build_queue(project, store, synced_list(project, store))


@router.post("/sync", response_model=VideoList)
def sync_storage(project: Project = Depends(project_access), store: Store = Depends(get_store)):
    """Re-read the bucket now ("Sync storage", or the queue's refresh button): the only way the queue
    picks up videos added to or removed from the bucket."""
    return sync_videos(project, store)


def flagged_queue(project: Project, store: Store) -> VideoList:
    """The queue a coach from another workspace gets: only the videos flagged for review, from the
    stored annotations (the bucket is never listed, and its name and folder aren't shown)."""
    flagged = project_review(project, store).videos
    return VideoList(
        videos=[
            VideoItem(
                key=v.key,
                filename=v.filename,
                status=v.status,
                event_count=v.event_count,
                annotated_at=v.annotated_at,
                updated_by=v.updated_by,
            )
            for v in flagged
        ],
        truncated=False,
        bucket="",
        prefix="",
        sync=SyncInfo(video_count=len(flagged), synced_at=utcnow(), total_bytes=0, truncated=False),
    )


def synced_list(project: Project, store: Store) -> SyncedList | None:
    """The videos the latest sync found in the current bucket and folder; None until one is run (and after
    the bucket or folder changes)."""
    if not project.storage.is_configured or project.last_sync is None:
        return None
    synced = store.load_synced_list(project.id)
    if synced is None:
        return rebuild_synced_list(project, store)
    if synced.bucket != project.storage.bucket or synced.prefix != project.storage.normalized_prefix:
        return None
    return synced


def rebuild_synced_list(project: Project, store: Store) -> SyncedList | None:
    """Projects synced before the list was kept only stored the counts. Rebuild it as that sync saw it, once:
    the videos in the bucket that were already there then (later uploads wait for the next sync)."""
    assert project.last_sync is not None
    try:
        objects, truncated = s3_service.list_videos(project.storage, get_settings().max_list_keys)
    except AppError as exc:
        log.warning("Could not rebuild the synced list of %s: %s", project.id, exc.message)
        return None
    cutoff = project.last_sync.synced_at
    synced = SyncedList(
        bucket=project.storage.bucket,
        prefix=project.storage.normalized_prefix,
        truncated=truncated,
        videos=[
            SyncedVideo(key=o.key, size=o.size, last_modified=o.last_modified)
            for o in objects
            if o.last_modified <= cutoff
        ],
    )
    store.save_synced_list(project.id, synced)
    return synced


def sync_videos(project: Project, store: Store) -> VideoList:
    """List the bucket, keep what was found, and return the queue built from it."""
    objects, truncated = s3_service.list_videos(project.storage, get_settings().max_list_keys)
    synced = SyncedList(
        bucket=project.storage.bucket,
        prefix=project.storage.normalized_prefix,
        truncated=truncated,
        videos=[SyncedVideo(key=o.key, size=o.size, last_modified=o.last_modified) for o in objects],
    )
    # Removed videos are left out of the counts, like everywhere else.
    kept = [o for o in objects if o.key not in project.removed_keys]
    # "New" = uploaded after the previous sync, judged by S3's own LastModified time.
    previous = project.last_sync
    sync = SyncInfo(
        video_count=len(kept),
        synced_at=utcnow(),
        new_count=sum(1 for o in kept if o.last_modified > previous.synced_at) if previous else None,
        total_bytes=sum(o.size for o in kept),
        truncated=truncated,
    )
    with store.lock(project.id):
        store.save_synced_list(project.id, synced)
        fresh = store.get(project.id)
        fresh.last_sync = sync
        store.save(fresh, touch=False)
    return build_queue(fresh, store, synced)


def build_queue(project: Project, store: Store, synced: SyncedList | None) -> VideoList:
    """The queue: the synced videos (minus removed ones) with their saved state, plus annotated videos the
    sync didn't find. Never touches S3."""
    removed = project.removed_keys
    objects = [v for v in synced.videos if v.key not in removed] if synced else []
    truncated = synced.truncated if synced else False
    index = {
        k: e for k, e in store.load_index(project.id).items() if belongs_to(e.bucket, project) and k not in removed
    }

    videos: list[VideoItem] = []
    seen: set[str] = set()
    for obj in objects:
        seen.add(obj.key)
        entry = index.get(obj.key)
        videos.append(
            VideoItem(
                key=obj.key,
                filename=posixpath.basename(obj.key),
                size=obj.size,
                last_modified=obj.last_modified,
                status=entry.status if entry else "not_started",
                event_count=entry.event_count if entry else 0,
                annotated_at=entry.updated_at if entry else None,
                updated_by=entry.updated_by if entry else None,
            )
        )
    # Never silently hide work: surface annotations whose video the sync didn't find. Before any sync, or
    # when the listing was truncated, we can't tell whether they still exist, so don't call them missing.
    for key, entry in index.items():
        if key in seen or not key.startswith(project.storage.normalized_prefix):
            continue
        videos.append(
            VideoItem(
                key=key,
                filename=posixpath.basename(key),
                status=entry.status,
                event_count=entry.event_count,
                annotated_at=entry.updated_at,
                updated_by=entry.updated_by,
                missing=synced is not None and not truncated,
            )
        )

    return VideoList(
        videos=videos,
        truncated=truncated,
        bucket=project.storage.bucket,
        prefix=project.storage.normalized_prefix,
        sync=project.last_sync if synced else None,
    )


def recount(project: Project, store: Store) -> None:
    """Keep the latest sync's totals (the dashboard's progress) in step after videos are deleted or restored."""
    synced = synced_list(project, store)
    if synced and project.last_sync:
        kept = [v for v in synced.videos if v.key not in project.removed_keys]
        project.last_sync = project.last_sync.model_copy(
            update={"video_count": len(kept), "total_bytes": sum(v.size for v in kept)}
        )


@router.get("/videos/stream-url", response_model=StreamUrl)
def stream_url(
    key: str = Query(..., min_length=1),
    verify: bool = Query(True, description="HEAD the object first for a precise error"),
    project: Project = Depends(project_access),
):
    require_video_key(project, key)
    if verify:
        s3_service.head_video(project.storage, key)
    url, expires_at = s3_service.presign(project.storage, key, project.settings.url_expiry_seconds)
    return StreamUrl(key=key, url=url, expires_at=expires_at)


@router.get("/videos/details", response_model=VideoDetails)
def video_details(
    project_id: str,
    key: str = Query(..., min_length=1),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    """Everything known about one video: S3 object metadata plus local annotation state.
    S3 failures are reported inline so local details still show for videos gone from the bucket."""
    require_video_key(project, key)
    cfg = project.storage
    folder, filename = posixpath.split(key)
    details = VideoDetails(
        key=key,
        filename=filename,
        folder=f"{folder}/" if folder else "",
        extension=posixpath.splitext(filename)[1].lower(),
        bucket=cfg.bucket,
        region=cfg.region,
        s3_uri=f"s3://{cfg.bucket}/{key}",
        console_url=None
        if cfg.endpoint_url
        else f"https://s3.console.aws.amazon.com/s3/object/{quote(cfg.bucket)}?region={cfg.region}&prefix={quote(key)}",
    )
    try:
        head = s3_service.head_video(cfg, key)
        details.size = head.get("ContentLength")
        details.content_type = head.get("ContentType")
        details.last_modified = head.get("LastModified")
        details.etag = (head.get("ETag") or "").strip('"') or None
        details.storage_class = head.get("StorageClass") or "STANDARD"
        details.user_metadata = head.get("Metadata") or {}
    except S3Error as exc:
        details.s3_error = exc.message

    annotation = store.get_annotation(project_id, key)
    if annotation:
        details.status = annotation.status
        details.event_count = len(annotation.events)
        details.annotated_at = annotation.updated_at
        details.updated_by = annotation.updated_by
        details.annotation_file = store.annotation_location(project_id, key)
        details.streaming_url = annotation.streaming_url
        details.duration_seconds = annotation.duration_seconds
    return details


@router.delete("/annotations", response_model=ClearResult)
def clear_annotation(
    project_id: str,
    key: str = Query(..., min_length=1),
    revision: str | None = Query(
        None, description="Revision the client saw ('' = nothing saved). If it changed meanwhile, nothing is cleared."
    ),
    user: User = Depends(current_user),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    """Clear a video's saved annotations. Nothing is erased: the file goes to app_data/.trash, or the
    database row is marked deleted."""
    # Clearing only touches stored annotations, so keys outside the current folder are fine.
    require_video_key(project, key, inside_prefix=False)
    with store.lock(project_id):
        refuse_if_saved_since(store, project_id, key, revision, action="cleared", retry="clear it")
        moved = store.clear_annotation(project_id, key, by=user.name)
    return ClearResult(key=key, cleared=moved is not None, moved_to=str(moved) if moved else None)


def refuse_if_saved_since(store: Store, project_id: str, key: str, revision: str | None, *, action: str, retry: str):
    """`revision` is the saved version the client saw ('' = nothing saved; None = don't check). Refuse when
    someone saved another one since, so their work is never thrown away unseen. Call under the lock."""
    if revision is None:
        return
    try:
        current = store.get_annotation(project_id, key)
    except StorageError:
        current = None  # unreadable: clearing it is exactly what's wanted
    # Nothing saved now: nothing to protect. Saved, but not the version the client saw: refuse.
    if current is not None and current.revision != revision:
        who = current.updated_by or "Someone else"
        raise ConflictError(
            f"{who} saved this video after you last saw it, so nothing was {action}.",
            code="CLEAR_CONFLICT",
            hint=f"Open the video to see the latest version, then {retry} again if you still want to.",
            details={"revision": current.revision, "updated_by": current.updated_by},
        )


@router.delete("/videos", response_model=ClearResult)
def remove_video(
    project_id: str,
    key: str = Query(..., min_length=1),
    revision: str | None = Query(None, description="As for clearing: refused if someone saved since"),
    user: User = Depends(current_user),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    """Remove a video from the project, for everyone in the workspace: it leaves the queue and the export,
    and its annotations are cleared (kept like "Clear annotations" does). The file in S3 is not touched,
    and restoring brings the video back."""
    require_video_key(project, key, inside_prefix=False)
    with store.lock(project_id):
        refuse_if_saved_since(store, project_id, key, revision, action="removed", retry="remove it")
        moved = store.clear_annotation(project_id, key, by=user.name)
        fresh = store.get(project_id)
        if key not in fresh.removed_keys:
            fresh.removed_videos.append(RemovedVideo(key=key, bucket=fresh.storage.bucket, removed_by=user.name))
            recount(fresh, store)
            store.save(fresh, touch=False)
    return ClearResult(key=key, cleared=moved is not None, moved_to=str(moved) if moved else None)


@router.post("/videos/restore", response_model=ProjectPublic)
def restore_video(
    project_id: str,
    key: str = Query(..., min_length=1),
    store: Store = Depends(get_store),
):
    """Put a removed video back in the queue (without the annotations cleared when it was removed)."""
    with store.lock(project_id):
        project = store.get(project_id)
        project.removed_videos = [
            r for r in project.removed_videos if not (r.key == key and r.bucket == project.storage.bucket)
        ]
        recount(project, store)
        store.save(project, touch=False)
    return to_public(project, store)


# --------------------------------------------------------------------------- #
# Several videos at once (selected in the queue)
# --------------------------------------------------------------------------- #


def split_unchanged(store: Store, project: Project, batch: VideoBatch) -> tuple[list[str], list[SkippedVideo]]:
    """The selected videos still at the version the client saw, and the ones someone saved since (left
    alone, like a single clear refuses). One read of the index, not one per video. Call under the lock."""
    for ref in batch.videos:
        require_video_key(project, ref.key, inside_prefix=False)
    index = store.load_index(project.id)
    ok: list[str] = []
    skipped: list[SkippedVideo] = []
    for ref in {r.key: r for r in batch.videos}.values():  # each video once
        entry = index.get(ref.key)
        if ref.revision is not None and entry is not None and entry.revision != ref.revision:
            skipped.append(SkippedVideo(key=ref.key, updated_by=entry.updated_by))
        else:
            ok.append(ref.key)
    return ok, skipped


@router.post("/annotations/clear-many", response_model=BatchResult)
def clear_many(
    project_id: str,
    batch: VideoBatch,
    user: User = Depends(current_user),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    """Clear the annotations of several videos (see clear_annotation). Videos someone saved after the client
    last saw them are skipped and reported."""
    with store.lock(project_id):
        ok, skipped = split_unchanged(store, project, batch)
        if ok:
            store.clear_annotations(project_id, ok, by=user.name)
    return BatchResult(done=ok, skipped=skipped)


@router.post("/videos/remove-many", response_model=BatchResult)
def remove_many(
    project_id: str,
    batch: VideoBatch,
    user: User = Depends(current_user),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    """Delete several videos from the project (see remove_video). Videos someone saved after the client
    last saw them are skipped and reported."""
    with store.lock(project_id):
        ok, skipped = split_unchanged(store, project, batch)
        if ok:
            store.clear_annotations(project_id, ok, by=user.name)
            fresh = store.get(project_id)
            already = fresh.removed_keys
            fresh.removed_videos += [
                RemovedVideo(key=key, bucket=fresh.storage.bucket, removed_by=user.name)
                for key in ok
                if key not in already
            ]
            recount(fresh, store)
            store.save(fresh, touch=False)
    return BatchResult(done=ok, skipped=skipped)


@router.post("/videos/restore-many", response_model=ProjectPublic)
def restore_many(project_id: str, batch: KeyBatch, store: Store = Depends(get_store)):
    """Put several deleted videos back in the queue (the "Undo" after deleting a selection)."""
    keys = set(batch.keys)
    with store.lock(project_id):
        project = store.get(project_id)
        project.removed_videos = [
            r for r in project.removed_videos if not (r.key in keys and r.bucket == project.storage.bucket)
        ]
        recount(project, store)
        store.save(project, touch=False)
    return to_public(project, store)


@router.post("/activity", response_model=ActivityResult)
def activity(
    project_id: str,
    body: ActivityPing,
    user: User = Depends(current_user),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    """Heartbeat from the Annotate view (every few seconds): records which video this user is on and
    returns the saved state of every video plus who else is where. Never touches S3."""
    as_of = utcnow()
    presence.touch(project_id, user, body.video_key)
    # A coach from another workspace hears only about the flagged videos (their whole queue).
    only = None if is_member(user, project) else {v.key for v in project_review(project, store).videos}
    videos = {
        key: VideoState(
            status=entry.status,
            event_count=entry.event_count,
            annotated_at=entry.updated_at,
            updated_by=entry.updated_by,
            revision=entry.revision,
        )
        for key, entry in store.load_index(project_id).items()
        if belongs_to(entry.bucket, project)
        and key.startswith(project.storage.normalized_prefix)
        and (only is None or key in only)
    }
    return ActivityResult(as_of=as_of, videos=videos, presence=presence.others(project_id, user))


@router.get("/review", response_model=ReviewList)
def review_videos(project: Project = Depends(project_access), store: Store = Depends(get_store)):
    """Videos flagged for coach review (see LabelSchema.review_field). Reads only stored annotations
    (never S3), from the current bucket and folder like the queue."""
    return project_review(project, store)


@review_router.get("", response_model=list[ProjectReview])
def review_all(user: User = Depends(current_user), store: Store = Depends(get_store)):
    """Every project that can flag videos for coach review, with its flagged videos (possibly none):
    the user's own workspace, and for coaches every workspace."""
    out = []
    for project in store.list_projects():
        if not (user.coach or is_member(user, project)):
            continue
        try:
            review = project_review(project, store)
        except AppError as exc:  # one unreadable project must not hide the others
            log.warning("Skipping coach review for %s: %s", project.id, exc.message)
            continue
        if review.field:
            out.append(ProjectReview(project_id=project.id, project_name=project.name, **review.model_dump()))
    return out


def project_review(project: Project, store: Store) -> ReviewList:
    key = project.settings.coach_review_field
    field = project.label_schema.review_field(key)
    if not field:
        return ReviewList(field_key=key, field=None, videos=[])
    stored, warnings = store.iter_annotations(project.id)
    prefix = project.storage.normalized_prefix
    videos = [
        ReviewVideo(
            key=ann.video_key,
            filename=ann.video_filename,
            status=ann.status,
            event_count=len(ann.events),
            duration_seconds=ann.duration_seconds,
            annotated_at=ann.updated_at,
            updated_by=ann.updated_by,
            labels=ann.labels,
        )
        for ann in stored
        if belongs_to(ann.bucket, project)
        and ann.video_key.startswith(prefix)
        and is_flagged(field, ann.labels.get(field.key))
    ]
    videos.sort(key=lambda v: v.annotated_at, reverse=True)
    return ReviewList(field_key=key, field=field, videos=videos, warnings=warnings)


@router.post("/review/done", response_model=VideoAnnotation | None)
def finish_review(
    project_id: str,
    key: str = Query(..., min_length=1),
    user: User = Depends(current_user),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    """The coach is done with a flagged video: clear its flag so it leaves the Coach review tab (it stays
    in the queue). Nothing else changes. Already cleared (e.g. by another coach) is not an error."""
    require_video_key(project, key, inside_prefix=False)
    field = project.label_schema.review_field(project.settings.coach_review_field)
    if not field:
        raise ValidationError("Coach review is not set up for this project.", code="REVIEW_NOT_CONFIGURED")
    with store.lock(project_id):
        existing = store.get_annotation(project_id, key)
        if not existing or not is_flagged(field, existing.labels.get(field.key)):
            return existing
        done = existing.model_copy(
            update={
                "labels": {**existing.labels, field.key: cleared_value(field)},
                "updated_at": utcnow(),
                "updated_by": user.name,
                "revision": secrets.token_hex(8),
            }
        )
        try:
            return store.save_annotation(project_id, done, expected_revision=existing.revision)
        except ConflictError as exc:
            latest = store.get_annotation(project_id, key)
            raise annotation_conflict(latest, cleared=latest is None) from exc


@router.get("/annotations", response_model=VideoAnnotation | None, dependencies=[Depends(project_access)])
def get_annotation(project_id: str, key: str = Query(..., min_length=1), store: Store = Depends(get_store)):
    return store.get_annotation(project_id, key)


@router.put("/annotations", response_model=VideoAnnotation)
def save_annotation(
    project_id: str,
    body: AnnotationSave,
    key: str = Query(..., min_length=1),
    user: User = Depends(current_user),
    project: Project = Depends(project_access),
    store: Store = Depends(get_store),
):
    require_video_key(project, key)
    if key in project.removed_keys:
        raise NotFoundError(
            "This video was removed from the project, so the changes were not saved.",
            code="VIDEO_REMOVED",
            hint="Restore it under Settings > General to work on it again.",
        )
    schema = project.label_schema
    fps = project.settings.fps
    event_fields = [f for f in schema.fields if f.scope == "event"]
    video_fields = [f for f in schema.fields if f.scope == "video"]
    checkbox_fields = [f for f in event_fields if f.type == "checkbox"]
    other_fields = [f for f in event_fields if f.type != "checkbox"]
    now = utcnow()

    # Whole-video answers: every checkbox explicit, unknown keys kept (schema edits never lose data).
    labels = {
        **body.labels,
        **{
            f.key: bool(body.labels.get(f.key, f.default))
            if f.type == "checkbox"
            else normalize_value(f, body.labels.get(f.key, f.default or None))  # type: ignore[arg-type]
            for f in video_fields
        },
    }

    with store.lock(project_id):
        try:
            existing = store.get_annotation(project_id, key)
        except StorageError as exc:
            if exc.code != "LOCAL_FILE_CORRUPT":
                raise
            store.quarantine_annotation(project_id, key)  # unreadable: keep a copy, start fresh
            existing = None
        current_revision = existing.revision if existing else None
        # No silent overwrites: edits based on an older copy are refused (unless the client opted out
        # by not sending base_revision).
        if "base_revision" in body.model_fields_set and body.base_revision != current_revision:
            raise annotation_conflict(existing, cleared=existing is None)
        # Frames saved under a different FPS setting are recomputed from their timestamps.
        refresh_frames = bool(existing and existing.fps and existing.fps != fps)

        events = []
        for ev in sorted(body.events, key=lambda e: (e.timestamp, e.id)):
            # Every checkbox is written explicitly as true/false, even if never touched. Values for
            # keys that are no longer in the schema are kept, so editing the schema never loses data.
            checkboxes = {
                **ev.checkboxes,
                **{f.key: bool(ev.checkboxes.get(f.key, f.default)) for f in checkbox_fields},
            }
            attributes = {
                **ev.attributes,
                **{f.key: normalize_value(f, ev.attributes.get(f.key, f.default or None)) for f in other_fields},
            }
            frame = ev.frame if ev.frame is not None and not refresh_frames else frame_at(ev.timestamp, fps)
            events.append(
                ev.model_copy(
                    update={
                        "timestamp": round(ev.timestamp, 3),
                        "time": format_timestamp(ev.timestamp),
                        "frame": frame,
                        "checkboxes": checkboxes,
                        "attributes": attributes,
                        "created_at": ev.created_at or now,
                        "updated_at": now,
                    }
                )
            )

        annotation = VideoAnnotation(
            video_key=key,
            video_filename=posixpath.basename(key),
            bucket=project.storage.bucket,
            s3_uri=f"s3://{project.storage.bucket}/{key}",
            streaming_url=body.streaming_url or (existing.streaming_url if existing else None),
            streaming_url_expires_at=body.streaming_url_expires_at
            or (existing.streaming_url_expires_at if existing else None),
            status=body.status,
            duration_seconds=body.duration_seconds or (existing.duration_seconds if existing else None),
            fps=fps,
            event_count=len(events),
            events=events,
            labels=labels,
            created_at=existing.created_at if existing else now,
            updated_at=now,
            revision=secrets.token_hex(8),
            updated_by=user.name,
        )
        try:
            return store.save_annotation(project_id, annotation, expected_revision=current_revision)
        except ConflictError as exc:
            # Another server process saved in between (the store's compare-and-set caught it).
            latest = store.get_annotation(project_id, key)
            raise annotation_conflict(latest, cleared=latest is None) from exc


def annotation_conflict(latest: VideoAnnotation | None, *, cleared: bool) -> ConflictError:
    """409 telling the client its edits are based on an outdated copy, and what the current one is."""
    who = (latest.updated_by if latest else None) or "Someone else"
    if cleared:
        message, hint = (
            "This video's annotations were cleared while you were editing.",
            "Keep yours to save them again, or reload to start from the cleared video.",
        )
    else:
        message, hint = (
            f"{who} saved this video while you were editing.",
            "Load their version, or keep yours to overwrite it.",
        )
    return ConflictError(
        message,
        code="ANNOTATION_CONFLICT",
        hint=hint,
        details={
            "revision": latest.revision if latest else None,
            "updated_by": latest.updated_by if latest else None,
            "updated_at": latest.updated_at.isoformat() if latest else None,
            "cleared": cleared,
        },
    )


def normalize_value(field: SchemaField, value: str | list[str] | None) -> str | list[str] | None:
    """Multiple-choice fields are always a list (possibly empty); everything else a string or None.
    A list with several values under a single-value field is kept as-is rather than truncated,
    so switching a field from multiple to single never drops answers."""
    if field.type == "choices" and field.multiple:
        if value is None or value == "":
            return []
        return [value] if isinstance(value, str) else list(value)
    if isinstance(value, list):
        if len(value) > 1:
            return value
        return value[0] if value else None
    return value if value != "" else None


def frame_at(seconds: float, fps: float) -> int:
    """Same rule as the player: the frame being shown at this time (tolerant of float error)."""
    return math.floor(seconds * fps + 1e-6)


def format_timestamp(seconds: float) -> str:
    ms_total = int(round(seconds * 1000))
    hours, rem = divmod(ms_total, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"
