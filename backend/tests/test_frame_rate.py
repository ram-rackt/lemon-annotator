"""Frame numbers use each video's own frame rate, read from its MP4 / MOV header."""

import struct

import boto3
from conftest import BUCKET

from app.video_info import FIRST_READ, frame_rate_from_moov, read_frame_rate


def box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def movie(timescale: int, frames: int, delta: int, *, mdhd_version: int = 0) -> bytes:
    """A minimal moov box: one video track whose frames each last `delta` / `timescale` seconds."""
    hdlr = box(b"hdlr", b"\x00" * 8 + b"vide" + b"\x00" * 12)
    if mdhd_version == 1:
        mdhd = box(b"mdhd", b"\x01\x00\x00\x00" + b"\x00" * 16 + struct.pack(">IQ", timescale, frames * delta))
    else:
        mdhd = box(b"mdhd", b"\x00" * 12 + struct.pack(">II", timescale, frames * delta))
    stts = box(b"stts", b"\x00" * 4 + struct.pack(">III", 1, frames, delta))
    # A sound track first, which must be skipped.
    sound = box(b"trak", box(b"mdia", box(b"hdlr", b"\x00" * 8 + b"soun" + b"\x00" * 12)))
    video = box(b"trak", box(b"mdia", hdlr + mdhd + box(b"minf", box(b"stbl", stts))))
    return box(b"moov", box(b"mvhd", b"\x00" * 100) + sound + video)


def mp4(moov: bytes, *, moov_first: bool, data_size: int = 200_000) -> bytes:
    """ftyp + video data + header, the header either up front ("fast start") or at the end (phones)."""
    ftyp = box(b"ftyp", b"qt  \x00\x00\x00\x00qt  ")
    mdat = box(b"mdat", b"\x00" * data_size)
    return ftyp + (moov + mdat if moov_first else mdat + moov)


def reader(data: bytes):
    calls = []

    def read(offset: int, length: int) -> tuple[bytes, int]:
        calls.append((offset, length))
        return data[offset : offset + length], len(data)

    return read, calls


def test_reads_the_video_tracks_rate():
    assert frame_rate_from_moov(movie(600, 180, 10)[8:]) == 60
    assert frame_rate_from_moov(movie(30000, 300, 1001)[8:]) == 29.97
    assert frame_rate_from_moov(movie(90000, 50, 3000, mdhd_version=1)[8:]) == 30


def test_finds_the_header_at_the_end_without_reading_the_video():
    read, calls = reader(mp4(movie(600, 180, 10), moov_first=False))
    assert read_frame_rate(read) == 60
    # The first read, a header peek past the video data, then the header itself: never the video.
    assert len(calls) == 3 and all(length <= FIRST_READ for _, length in calls)

    read, calls = reader(mp4(movie(24000, 48, 1001), moov_first=True))
    assert read_frame_rate(read) == 23.976
    assert len(calls) == 1


def test_unreadable_files_have_no_rate():
    for data in (b"", b"\x00" * 16, b"not a video at all", mp4(box(b"moov", b""), moov_first=True)):
        read, _ = reader(data)
        assert read_frame_rate(read) is None


def test_frame_rate_endpoint_and_frames(client, project):
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.put_object(Bucket=BUCKET, Key="clips/phone_60.mov", Body=mp4(movie(600, 180, 10), moov_first=False))

    res = client.get(f"/api/projects/{project}/videos/frame-rate", params={"key": "clips/phone_60.mov"})
    assert res.json() == {"key": "clips/phone_60.mov", "fps": 60.0, "detected": True}
    # Not a real video (the fixtures are 16 zero bytes): the project's setting, marked as not detected.
    res = client.get(f"/api/projects/{project}/videos/frame-rate", params={"key": "clips/rally_001.mp4"})
    assert res.json() == {"key": "clips/rally_001.mp4", "fps": 30.0, "detected": False}

    # Frames are numbered at the rate the client sends, whatever frame it sent.
    event = {"id": "a", "timestamp": 1.5, "frame": 45, "checkboxes": {}, "attributes": {}, "note": ""}
    saved = client.put(f"/api/projects/{project}/annotations", params={"key": "clips/phone_60.mov"},
                       json={"events": [event], "fps": 60}).json()
    assert saved["fps"] == 60 and saved["events"][0]["frame"] == 90
    # Without one (an older client), the project's setting.
    saved = client.put(f"/api/projects/{project}/annotations", params={"key": "clips/phone_60.mov"},
                       json={"events": [event]}).json()
    assert saved["fps"] == 30 and saved["events"][0]["frame"] == 45
