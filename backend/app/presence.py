"""Who is looking at which video, from the Annotate view's heartbeat.

Kept in memory: it only describes the last few seconds and is rebuilt by the next heartbeats after a
restart. (Lemon runs as a single server process.)
"""

import threading
from datetime import timedelta

from .auth import User
from .models import PresenceEntry, utcnow

# A user who hasn't sent a heartbeat for this long is no longer shown.
STALE_AFTER = timedelta(seconds=45)

_lock = threading.Lock()
_entries: dict[tuple[str, str], PresenceEntry] = {}


def touch(project_id: str, user: User, video_key: str | None) -> None:
    with _lock:
        _entries[(project_id, user.id)] = PresenceEntry(
            user_id=user.id, name=user.name or "Someone", video_key=video_key, seen_at=utcnow()
        )


def others(project_id: str, user: User) -> list[PresenceEntry]:
    """Everyone else recently active in this project."""
    cutoff = utcnow() - STALE_AFTER
    with _lock:
        for key in [k for k, e in _entries.items() if e.seen_at < cutoff]:
            del _entries[key]
        return sorted(
            (e for (pid, uid), e in _entries.items() if pid == project_id and uid != user.id),
            key=lambda e: e.name.lower(),
        )


def clear() -> None:
    with _lock:
        _entries.clear()
