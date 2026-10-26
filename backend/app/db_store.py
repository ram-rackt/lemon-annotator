"""Database persistence (Postgres, e.g. Supabase) with the same interface as storage.ProjectStore.

Tables live in their own `lemon` schema, which Supabase does not expose through its Data API, and have
row-level security switched on, so project data (including the AWS keys) is reachable only through this
backend. Nothing is ever erased: deleting a project or clearing a video sets `deleted_at` on the row.

SQLite (`sqlite:///path/to/file.db`) is supported as well; the test suite uses it.
"""

import json
import logging
import secrets
import sqlite3
import threading
from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from .errors import NotFoundError, StorageError, ValidationError
from .models import IndexEntry, ProgressStats, Project, VideoAnnotation, utcnow
from .storage import (
    ANY_REVISION,
    PROJECT_ID_RE,
    export_file_name,
    progress_stats,
    revision_conflict,
    slugify,
)

log = logging.getLogger(__name__)

POSTGRES_SCHEMA = """
CREATE SCHEMA IF NOT EXISTS lemon;

CREATE TABLE IF NOT EXISTS lemon.projects (
    id          text PRIMARY KEY,
    data        jsonb NOT NULL,
    created_at  timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL,
    deleted_at  timestamptz,
    deleted_by  text
);

CREATE TABLE IF NOT EXISTS lemon.annotations (
    id          bigserial PRIMARY KEY,
    project_id  text NOT NULL REFERENCES lemon.projects (id),
    video_key   text NOT NULL,
    bucket      text,
    status      text NOT NULL,
    event_count integer NOT NULL,
    revision    text NOT NULL,
    data        jsonb NOT NULL,
    updated_at  timestamptz NOT NULL,
    updated_by  text,
    deleted_at  timestamptz,
    deleted_by  text
);
CREATE UNIQUE INDEX IF NOT EXISTS annotations_live_video
    ON lemon.annotations (project_id, video_key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lemon.exports (
    id          bigserial PRIMARY KEY,
    project_id  text NOT NULL REFERENCES lemon.projects (id),
    filename    text NOT NULL,
    data        jsonb NOT NULL,
    created_at  timestamptz NOT NULL,
    created_by  text
);

ALTER TABLE lemon.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE lemon.annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lemon.exports ENABLE ROW LEVEL SECURITY;

-- Supabase's API roles get no access at all; only this backend (the postgres role) reads the tables.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON SCHEMA lemon FROM anon, authenticated;
        REVOKE ALL ON ALL TABLES IN SCHEMA lemon FROM anon, authenticated;
    END IF;
END $$;
"""

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    deleted_by  TEXT
);
CREATE TABLE IF NOT EXISTS annotations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES projects (id),
    video_key   TEXT NOT NULL,
    bucket      TEXT,
    status      TEXT NOT NULL,
    event_count INTEGER NOT NULL,
    revision    TEXT NOT NULL,
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    updated_by  TEXT,
    deleted_at  TEXT,
    deleted_by  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS annotations_live_video
    ON annotations (project_id, video_key) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS exports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES projects (id),
    filename    TEXT NOT NULL,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    created_by  TEXT
);
"""


# --------------------------------------------------------------------------- #
# Connections: one small adapter per engine, so the store's SQL is written once
# --------------------------------------------------------------------------- #


class _Tx:
    """A transaction. SQL uses %s placeholders and {p} before table names."""

    def __init__(self, cursor: Any, sqlite: bool, prefix: str) -> None:
        self._cur = cursor
        self._sqlite = sqlite
        self._prefix = prefix

    def execute(self, sql: str, params: tuple = ()) -> Any:
        sql = sql.replace("{p}", self._prefix)
        if self._sqlite:
            sql = sql.replace("%s", "?")
            self._cur.execute(sql, tuple(p.isoformat() if isinstance(p, datetime) else p for p in params))
        else:
            # No parameters: psycopg sends the text as-is, which allows a multi-statement script.
            self._cur.execute(sql, params or None)
        return self._cur


class _Postgres:
    sqlite = False
    prefix = "lemon."

    def __init__(self, url: str) -> None:
        import psycopg
        from psycopg_pool import ConnectionPool, PoolTimeout

        self._errors: tuple[type[Exception], ...] = (psycopg.OperationalError, PoolTimeout)
        self.unique_violation: type[Exception] = psycopg.errors.UniqueViolation
        self.pool = ConnectionPool(
            conninfo=url,
            min_size=1,
            max_size=5,
            # prepare_threshold=None: no server-side prepared statements, so Supabase's transaction
            # pooler (port 6543) works as well as the session pooler and direct connections.
            kwargs={"prepare_threshold": None, "connect_timeout": 10},
            check=ConnectionPool.check_connection,
            open=False,
            name="lemon",
        )
        try:
            self.pool.open(wait=True, timeout=30)
        except self._errors as exc:
            self.pool.close()
            raise _unavailable(exc) from exc
        with self.transaction() as tx:
            tx.execute(POSTGRES_SCHEMA)

    def json(self, value: Any) -> Any:
        from psycopg.types.json import Jsonb

        return Jsonb(value)

    @contextmanager
    def transaction(self) -> Iterator[_Tx]:
        try:
            # Commits when the block succeeds, rolls back when it raises.
            with self.pool.connection() as conn:
                yield _Tx(conn.cursor(), False, self.prefix)
        except self._errors as exc:
            raise _unavailable(exc) from exc

    def close(self) -> None:
        self.pool.close()


class _Sqlite:
    sqlite = True
    prefix = ""
    unique_violation = sqlite3.IntegrityError

    def __init__(self, path: str) -> None:
        self.path = path
        with self._connect() as conn:
            conn.executescript(SQLITE_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def json(self, value: Any) -> str:
        return json.dumps(value, ensure_ascii=False)

    @contextmanager
    def transaction(self) -> Iterator[_Tx]:
        conn = self._connect()
        try:
            yield _Tx(conn.cursor(), True, self.prefix)
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def close(self) -> None:
        pass


def _unavailable(exc: Exception) -> StorageError:
    return StorageError(
        f"Could not reach the database: {str(exc).strip().splitlines()[0] if str(exc).strip() else exc}",
        code="DATABASE_UNAVAILABLE",
        status_code=503,
        hint="Check LEMON_DATABASE_URL (Supabase > Connect > Session pooler) and that the Supabase project is not paused.",
    )


def connect(url: str) -> "_Postgres | _Sqlite":
    if url.startswith("sqlite:///"):
        return _Sqlite(url.removeprefix("sqlite:///"))
    if url.startswith(("postgres://", "postgresql://")):
        return _Postgres(url)
    raise StorageError(
        "LEMON_DATABASE_URL must start with postgresql:// (or sqlite:/// for tests).",
        code="DATABASE_URL_INVALID",
    )


def _load(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


# --------------------------------------------------------------------------- #
# Store
# --------------------------------------------------------------------------- #


class DatabaseStore:
    def __init__(self, url: str) -> None:
        self.db = connect(url)
        self.root = "database"  # shown by /api/health
        self._locks: defaultdict[str, threading.RLock] = defaultdict(threading.RLock)
        self._locks_guard = threading.Lock()

    def close(self) -> None:
        self.db.close()

    # ----------------------------------------------------------------- utils
    def lock(self, project_id: str) -> threading.RLock:
        """Serializes read-modify-write sequences within this process. Cross-process safety for
        annotations comes from the revision check in save_annotation."""
        with self._locks_guard:
            return self._locks[project_id]

    def _where(self, location: str) -> str:
        return f"database table {self.db.prefix}{location}"

    @staticmethod
    def _require_project(tx: _Tx, project_id: str) -> None:
        if not PROJECT_ID_RE.fullmatch(project_id):
            raise NotFoundError(f"Project '{project_id}' not found")
        row = tx.execute(
            "SELECT 1 FROM {p}projects WHERE id = %s AND deleted_at IS NULL", (project_id,)
        ).fetchone()
        if not row:
            raise NotFoundError(f"Project '{project_id}' not found")

    # -------------------------------------------------------------- projects
    def list_projects(self) -> list[Project]:
        with self.db.transaction() as tx:
            rows = tx.execute("SELECT id, data FROM {p}projects WHERE deleted_at IS NULL").fetchall()
        projects = []
        for project_id, data in rows:
            try:
                projects.append(Project.model_validate(_load(data)))
            except PydanticValidationError as exc:  # one bad row must not hide every project
                log.warning("Skipping project %s: %s", project_id, exc)
        projects.sort(key=lambda p: p.updated_at, reverse=True)
        return projects

    def get(self, project_id: str) -> Project:
        if not PROJECT_ID_RE.fullmatch(project_id):
            raise NotFoundError(f"Project '{project_id}' not found")
        with self.db.transaction() as tx:
            row = tx.execute(
                "SELECT data FROM {p}projects WHERE id = %s AND deleted_at IS NULL", (project_id,)
            ).fetchone()
        if not row:
            raise NotFoundError(f"Project '{project_id}' not found")
        try:
            return Project.model_validate(_load(row[0]))
        except PydanticValidationError as exc:
            raise StorageError(
                f"Stored settings for '{project_id}' are invalid.",
                code="STORED_DATA_CORRUPT",
                hint=str(exc.errors()[0].get("msg")) if exc.errors() else None,
            ) from exc

    def project_exists(self, project_id: str) -> bool:
        """True if the id is taken, including by a deleted project."""
        with self.db.transaction() as tx:
            return tx.execute("SELECT 1 FROM {p}projects WHERE id = %s", (project_id,)).fetchone() is not None

    def insert_project(self, project: Project) -> bool:
        """Add a project as-is (keeps its id and dates). False if the id is already taken."""
        with self.db.transaction() as tx:
            cur = tx.execute(
                "INSERT INTO {p}projects (id, data, created_at, updated_at) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (id) DO NOTHING",
                (project.id, self.db.json(project.model_dump(mode="json")), project.created_at, project.updated_at),
            )
            return cur.rowcount == 1

    def create(self, name: str, description: str = "") -> Project:
        base = slugify(name)
        for _ in range(10):
            project = Project(id=f"{base}-{secrets.token_hex(3)}", name=name.strip(), description=description.strip())
            if self.insert_project(project):
                return project
        raise StorageError("Could not allocate a project id")  # pragma: no cover

    def save(self, project: Project, touch: bool = True) -> Project:
        if touch:
            project.updated_at = utcnow()
        with self.db.transaction() as tx:
            cur = tx.execute(
                "UPDATE {p}projects SET data = %s, updated_at = %s WHERE id = %s AND deleted_at IS NULL",
                (self.db.json(project.model_dump(mode="json")), project.updated_at, project.id),
            )
            if cur.rowcount == 0:
                raise NotFoundError(f"Project '{project.id}' not found")
        return project

    def delete(self, project_id: str, by: str | None = None) -> str:
        with self.db.transaction() as tx:
            self._require_project(tx, project_id)
            tx.execute(
                "UPDATE {p}projects SET deleted_at = %s, deleted_by = %s WHERE id = %s AND deleted_at IS NULL",
                (utcnow(), by, project_id),
            )
        return f"{self._where('projects')} (marked as deleted, restorable)"

    # ----------------------------------------------------------- annotations
    def get_annotation(self, project_id: str, key: str) -> VideoAnnotation | None:
        with self.db.transaction() as tx:
            self._require_project(tx, project_id)
            row = tx.execute(
                "SELECT data FROM {p}annotations WHERE project_id = %s AND video_key = %s AND deleted_at IS NULL",
                (project_id, key),
            ).fetchone()
        if not row:
            return None
        try:
            return VideoAnnotation.model_validate(_load(row[0]))
        except PydanticValidationError as exc:
            raise StorageError(
                f"Stored annotations for '{key}' are invalid.",
                code="LOCAL_FILE_CORRUPT",
                hint="Saving the video again replaces them (the old row is kept, marked as deleted).",
            ) from exc

    def annotation_location(self, project_id: str, key: str) -> str | None:
        return self._where("annotations") if self.get_annotation(project_id, key) else None

    def _soft_delete_annotation(self, project_id: str, key: str, by: str | None) -> bool:
        with self.db.transaction() as tx:
            self._require_project(tx, project_id)
            cur = tx.execute(
                "UPDATE {p}annotations SET deleted_at = %s, deleted_by = %s "
                "WHERE project_id = %s AND video_key = %s AND deleted_at IS NULL",
                (utcnow(), by, project_id, key),
            )
            return cur.rowcount > 0

    def quarantine_annotation(self, project_id: str, key: str) -> str | None:
        """Set an unreadable row aside so the video can be saved again."""
        if not self._soft_delete_annotation(project_id, key, "lemon: unreadable data"):
            return None
        log.warning("Set aside unreadable annotations for %s / %s", project_id, key)
        return f"{self._where('annotations')} (marked as deleted)"

    def clear_annotation(self, project_id: str, key: str, by: str | None = None) -> str | None:
        """Remove a video's saved annotations: the row is marked deleted, never erased."""
        if not self._soft_delete_annotation(project_id, key, by):
            return None
        return f"{self._where('annotations')} (marked as deleted, restorable)"

    def save_annotation(
        self, project_id: str, annotation: VideoAnnotation, expected_revision: object = ANY_REVISION
    ) -> VideoAnnotation:
        """Write a video's annotations. With `expected_revision` (None: "nothing saved yet"), the write
        is atomic compare-and-set: it only happens if the saved row is still at that revision."""
        if not annotation.video_key:
            raise ValidationError("video_key is required")
        data = self.db.json(annotation.model_dump(mode="json"))
        values = (
            annotation.bucket,
            annotation.status,
            len(annotation.events),
            annotation.revision,
            data,
            annotation.updated_at,
            annotation.updated_by,
        )
        update = (
            "UPDATE {p}annotations SET bucket = %s, status = %s, event_count = %s, revision = %s, data = %s, "
            "updated_at = %s, updated_by = %s WHERE project_id = %s AND video_key = %s AND deleted_at IS NULL"
        )
        insert = (
            "INSERT INTO {p}annotations (bucket, status, event_count, revision, data, updated_at, updated_by, "
            "project_id, video_key) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
        )
        where = (project_id, annotation.video_key)
        try:
            with self.db.transaction() as tx:
                self._require_project(tx, project_id)
                if expected_revision is ANY_REVISION:
                    if tx.execute(update, values + where).rowcount == 0:
                        tx.execute(insert, values + where)
                elif expected_revision is None:
                    tx.execute(insert, values + where)  # fails on the unique index if a row appeared
                elif tx.execute(update + " AND revision = %s", values + where + (expected_revision,)).rowcount == 0:
                    raise revision_conflict()
        except self.db.unique_violation as exc:
            raise revision_conflict() from exc
        return annotation

    def load_index(self, project_id: str) -> dict[str, IndexEntry]:
        with self.db.transaction() as tx:
            self._require_project(tx, project_id)
            rows = tx.execute(
                "SELECT video_key, status, event_count, updated_at, bucket, revision, updated_by "
                "FROM {p}annotations WHERE project_id = %s AND deleted_at IS NULL",
                (project_id,),
            ).fetchall()
        return {
            key: IndexEntry(
                status=status,
                event_count=count,
                updated_at=updated_at,
                bucket=bucket,
                revision=revision,
                updated_by=updated_by,
            )
            for key, status, count, updated_at, bucket, revision, updated_by in rows
        }

    def iter_annotations(self, project_id: str) -> tuple[list[VideoAnnotation], list[str]]:
        with self.db.transaction() as tx:
            self._require_project(tx, project_id)
            rows = tx.execute(
                "SELECT video_key, data FROM {p}annotations WHERE project_id = %s AND deleted_at IS NULL",
                (project_id,),
            ).fetchall()
        out: list[VideoAnnotation] = []
        warnings: list[str] = []
        for key, data in rows:
            try:
                out.append(VideoAnnotation.model_validate(_load(data)))
            except PydanticValidationError:
                warnings.append(f"Skipped {key}: its stored annotations are invalid.")
        return out, warnings

    def stats(self, project: Project) -> ProgressStats:
        try:
            return progress_stats(project, self.load_index(project.id))
        except (StorageError, NotFoundError):
            return ProgressStats()

    # --------------------------------------------------------------- exports
    def write_export(self, project: Project, data: dict, by: str | None = None) -> tuple[str, str]:
        filename = export_file_name(project)
        with self.db.transaction() as tx:
            self._require_project(tx, project.id)
            tx.execute(
                "INSERT INTO {p}exports (project_id, filename, data, created_at, created_by) VALUES (%s, %s, %s, %s, %s)",
                (project.id, filename, self.db.json(data), utcnow(), by),
            )
        return filename, self._where("exports")
