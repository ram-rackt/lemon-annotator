"""A video's real frame rate, read from its MP4 / MOV header.

Browsers don't expose a video's frame rate, and assuming one (the project's FPS setting) gives wrong frame
numbers for clips recorded at another rate (60 fps phone footage, 29.97 fps cameras...). MP4 and MOV share
the ISO base media format: the video track's `mdhd` box has the time scale and its `stts` table the sample
(frame) durations, so the average rate is frames / duration. Only the boxes are read, with S3 range
requests, never the video data itself.
"""

import logging
import struct
import threading
from collections.abc import Callable

from botocore.exceptions import BotoCoreError, ClientError

from . import s3_service
from .errors import S3Error
from .models import StorageConfig

log = logging.getLogger(__name__)

# The first read covers small files and headers stored up front ("fast start") in one request.
FIRST_READ = 64 * 1024
# A header larger than this isn't worth reading (hours of footage); the project's setting is used instead.
MAX_HEADER = 32 * 1024 * 1024
MAX_TOP_LEVEL_BOXES = 64
MAX_FPS = 240

# (bytes at offset, total file size)
RangeReader = Callable[[int, int], tuple[bytes, int]]


def _boxes(data: bytes):
    """(type, payload) of each box in `data`, in order."""
    pos = 0
    while pos + 8 <= len(data):
        size, kind = struct.unpack_from(">I4s", data, pos)
        header = 8
        if size == 1:
            if pos + 16 > len(data):
                return
            size = struct.unpack_from(">Q", data, pos + 8)[0]
            header = 16
        elif size == 0:
            size = len(data) - pos
        if size < header or pos + size > len(data):
            return
        yield kind, data[pos + header : pos + size]
        pos += size


def _child(data: bytes, kind: bytes) -> bytes | None:
    return next((payload for k, payload in _boxes(data) if k == kind), None)


def frame_rate_from_moov(moov: bytes) -> float | None:
    """Average frame rate of the first video track in a `moov` box's contents, or None."""
    for kind, trak in _boxes(moov):
        if kind != b"trak":
            continue
        mdia = _child(trak, b"mdia")
        hdlr = mdia and _child(mdia, b"hdlr")
        if not hdlr or hdlr[8:12] != b"vide":  # version/flags (4), pre_defined (4), handler type
            continue
        mdhd = _child(mdia, b"mdhd")
        minf = _child(mdia, b"minf")
        stbl = minf and _child(minf, b"stbl")
        stts = stbl and _child(stbl, b"stts")
        if not mdhd or not stts or len(stts) < 8:
            continue
        # mdhd: version 1 has 64-bit creation / modification times before the time scale.
        offset = 20 if mdhd[0] == 1 else 12
        if len(mdhd) < offset + 4:
            continue
        timescale = struct.unpack_from(">I", mdhd, offset)[0]
        count = struct.unpack_from(">I", stts, 4)[0]
        frames = duration = 0
        for i in range(min(count, (len(stts) - 8) // 8)):
            samples, delta = struct.unpack_from(">II", stts, 8 + i * 8)
            frames += samples
            duration += samples * delta
        if timescale and frames and duration:
            fps = frames * timescale / duration
            if 1 <= fps <= MAX_FPS:
                return round(fps, 3)
    return None


def read_frame_rate(read: RangeReader) -> float | None:
    """Find the top-level `moov` box (before or after the video data) and read the rate from it."""
    head, total = read(0, FIRST_READ)
    pos = 0
    for _ in range(MAX_TOP_LEVEL_BOXES):
        if pos + 8 > total:
            return None
        chunk = head[pos : pos + 16] if pos + 16 <= len(head) else read(pos, 16)[0]
        if len(chunk) < 8:
            return None
        size, kind = struct.unpack_from(">I4s", chunk)
        header = 8
        if size == 1:
            if len(chunk) < 16:
                return None
            size, header = struct.unpack_from(">Q", chunk, 8)[0], 16
        elif size == 0:
            size = total - pos
        if size < header:
            return None
        if kind == b"moov":
            if size > MAX_HEADER:
                return None
            body = head[pos + header : pos + size] if pos + size <= len(head) else read(pos + header, size - header)[0]
            return frame_rate_from_moov(body)
        pos += size
    return None


def _s3_reader(cfg: StorageConfig, key: str) -> RangeReader:
    client = s3_service.get_client(cfg)

    def read(offset: int, length: int) -> tuple[bytes, int]:
        resp = client.get_object(Bucket=cfg.bucket, Key=key, Range=f"bytes={offset}-{offset + length - 1}")
        total = int(str(resp.get("ContentRange", "")).rpartition("/")[2] or resp["ContentLength"])
        return resp["Body"].read(), total

    return read


_cache: dict[tuple[str, str, str], float | None] = {}
_cache_lock = threading.Lock()
CACHE_SIZE = 5000


def frame_rate(cfg: StorageConfig, key: str) -> float | None:
    """The video's frame rate, or None when it can't be read (not an MP4 / MOV header Lemon understands,
    or S3 refused). Remembered per video: a file's frame rate doesn't change."""
    cache_key = (cfg.endpoint_url, cfg.bucket, key)
    with _cache_lock:
        if cache_key in _cache:
            return _cache[cache_key]
    try:
        fps = read_frame_rate(_s3_reader(cfg, key))
    except (ClientError, BotoCoreError, S3Error, struct.error, ValueError, KeyError) as exc:
        # Possibly temporary (network, permissions being fixed): not remembered.
        log.info("Could not read the frame rate of %s: %s", key, exc)
        return None
    with _cache_lock:
        if len(_cache) >= CACHE_SIZE:
            _cache.pop(next(iter(_cache)))
        _cache[cache_key] = fps
    return fps
