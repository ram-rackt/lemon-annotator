"""Shared use: database storage, sign-in, no silent overwrites, presence, migration and deploy guards."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db_store import DatabaseStore
from app.errors import ConflictError
from app.main import app
from app.migrate import migrate
from app.models import VideoAnnotation
from app.storage import ProjectStore

from conftest import BUCKET, app_client, bearer, create_project, make_token

KEY = "clips/rally_001.mp4"


def _event(id_="a", ts=1.0):
    return {"id": id_, "timestamp": ts, "event_name": None, "checkboxes": {}, "attributes": {}, "note": ""}


def _put(client, project, body, key=KEY, headers=None):
    return client.put(f"/api/projects/{project}/annotations", params={"key": key}, json=body, headers=headers)


# --------------------------------------------------------------------------- #
# No silent overwrites (both stores)
# --------------------------------------------------------------------------- #


def test_save_based_on_an_outdated_copy_is_refused(any_client, any_project):
    first = _put(any_client, any_project, {"events": [_event()], "base_revision": None})
    assert first.status_code == 200, first.text
    rev1 = first.json()["revision"]
    assert rev1

    second = _put(any_client, any_project, {"events": [_event(), _event("b", 2)], "base_revision": rev1})
    assert second.status_code == 200
    rev2 = second.json()["revision"]
    assert rev2 != rev1

    stale = _put(any_client, any_project, {"events": [], "base_revision": rev1})
    assert stale.status_code == 409
    err = stale.json()["error"]
    assert err["code"] == "ANNOTATION_CONFLICT"
    assert err["details"]["revision"] == rev2 and err["details"]["cleared"] is False
    # Nothing was overwritten.
    stored = any_client.get(f"/api/projects/{any_project}/annotations", params={"key": KEY}).json()
    assert stored["revision"] == rev2 and stored["event_count"] == 2

    # "Keep mine": retry based on the current revision.
    keep = _put(any_client, any_project, {"events": [], "base_revision": rev2})
    assert keep.status_code == 200 and keep.json()["event_count"] == 0

    # Clients that don't send base_revision keep the old last-write-wins behaviour.
    assert _put(any_client, any_project, {"events": [_event()]}).status_code == 200


def test_two_first_saves_do_not_overwrite_each_other(any_client, any_project):
    assert _put(any_client, any_project, {"events": [_event()], "base_revision": None}).status_code == 200
    second = _put(any_client, any_project, {"events": [], "base_revision": None})
    assert second.status_code == 409 and second.json()["error"]["details"]["cleared"] is False


def test_save_after_someone_cleared_the_video_is_refused(any_client, any_project):
    rev = _put(any_client, any_project, {"events": [_event()], "base_revision": None}).json()["revision"]
    assert any_client.delete(f"/api/projects/{any_project}/annotations", params={"key": KEY}).json()["cleared"]

    stale = _put(any_client, any_project, {"events": [_event()], "base_revision": rev})
    assert stale.status_code == 409 and stale.json()["error"]["details"]["cleared"] is True
    # Re-saving on top of the cleared video (base: nothing saved) works.
    assert _put(any_client, any_project, {"events": [_event()], "base_revision": None}).status_code == 200


def test_activity_reports_saved_state_without_touching_s3(any_client, any_project):
    saved = _put(any_client, any_project, {"status": "completed", "events": [_event()]}).json()
    res = any_client.post(f"/api/projects/{any_project}/activity", json={"video_key": KEY})
    assert res.status_code == 200
    body = res.json()
    assert body["videos"][KEY]["status"] == "completed"
    assert body["videos"][KEY]["revision"] == saved["revision"]
    assert body["presence"] == []  # only yourself


def test_store_compare_and_set_catches_races(tmp_path):
    """Two server processes saving from the same revision: only the first write wins."""
    for store in (ProjectStore(tmp_path / "files"), DatabaseStore(f"sqlite:///{tmp_path / 'race.db'}")):
        project = store.create("Race")
        base = store.save_annotation(project.id, _annotation("r1"), expected_revision=None)
        store.save_annotation(project.id, _annotation("r2"), expected_revision=base.revision)
        with pytest.raises(ConflictError):
            store.save_annotation(project.id, _annotation("r3"), expected_revision=base.revision)
        with pytest.raises(ConflictError):
            store.save_annotation(project.id, _annotation("r4"), expected_revision=None)
        assert store.get_annotation(project.id, KEY).revision == "r2"


def _annotation(revision: str) -> VideoAnnotation:
    return VideoAnnotation(video_key=KEY, video_filename="rally_001.mp4", bucket=BUCKET,
                           s3_uri=f"s3://{BUCKET}/{KEY}", revision=revision)


def test_files_saved_before_revisions_get_a_stable_one(client, project, tmp_path):
    saved = _put(client, project, {"events": [_event()]}).json()
    ann_dir = tmp_path / "app_data" / "projects" / project / "annotations"
    path = next(p for p in ann_dir.glob("*.json") if p.name != "_index.json")
    import json

    legacy = json.loads(path.read_text())
    legacy.pop("revision")
    legacy.pop("updated_by")
    path.write_text(json.dumps(legacy))
    index = json.loads((ann_dir / "_index.json").read_text())
    index[KEY].pop("revision")
    (ann_dir / "_index.json").write_text(json.dumps(index))

    first = client.get(f"/api/projects/{project}/annotations", params={"key": KEY}).json()["revision"]
    again = client.get(f"/api/projects/{project}/annotations", params={"key": KEY}).json()["revision"]
    assert first and first == again and first != saved["revision"]
    activity = client.post(f"/api/projects/{project}/activity", json={}).json()
    assert activity["videos"][KEY]["revision"] == first  # the index picked it up
    assert _put(client, project, {"events": [], "base_revision": first}).status_code == 200


# --------------------------------------------------------------------------- #
# Database store
# --------------------------------------------------------------------------- #


def test_database_store_end_to_end(db_client, tmp_path):
    pid = create_project(db_client)
    assert db_client.get("/api/health").json()["storage"] == "database"
    secret_free = db_client.get(f"/api/projects/{pid}").json()
    assert secret_free["storage"]["has_secret_access_key"] and "s3cr3t" not in str(secret_free)

    videos = db_client.get(f"/api/projects/{pid}/videos").json()["videos"]
    assert [v["key"] for v in videos] == ["clips/rally_001.mp4", "clips/serve_003.mov", "clips/set2/RALLY_002.MP4"]
    assert db_client.get(f"/api/projects/{pid}").json()["last_sync"]["video_count"] == 3

    saved = _put(db_client, pid, {"status": "completed", "events": [_event(), _event("b", 2)],
                                  "base_revision": None})
    assert saved.status_code == 200, saved.text
    queue = {v["key"]: v for v in db_client.get(f"/api/projects/{pid}/videos").json()["videos"]}
    assert queue[KEY]["status"] == "completed" and queue[KEY]["event_count"] == 2
    assert db_client.get(f"/api/projects/{pid}").json()["stats"]["completed"] == 1

    details = db_client.get(f"/api/projects/{pid}/videos/details", params={"key": KEY}).json()
    assert "annotations" in details["annotation_file"]

    export = db_client.post(f"/api/projects/{pid}/export").json()
    assert export["filename"].startswith("badminton_") and "exports" in export["path"]
    assert export["data"]["summary"]["completed"] == 1 and export["data"]["summary"]["total_videos"] == 3

    # Clearing and deleting mark rows as deleted; nothing is erased.
    cleared = db_client.delete(f"/api/projects/{pid}/annotations", params={"key": KEY}).json()
    assert cleared["cleared"] and "marked as deleted" in cleared["moved_to"]
    assert db_client.get(f"/api/projects/{pid}/annotations", params={"key": KEY}).json() is None
    assert db_client.delete(f"/api/projects/{pid}/annotations", params={"key": KEY}).json()["cleared"] is False

    deleted = db_client.delete(f"/api/projects/{pid}").json()
    assert "marked as deleted" in deleted["moved_to"]
    assert db_client.get(f"/api/projects/{pid}").status_code == 404
    assert db_client.get("/api/projects").json() == []
    assert _put(db_client, pid, {"events": []}).status_code == 404

    if get_settings().database_url.startswith("sqlite:///"):
        with sqlite3.connect(get_settings().database_url.removeprefix("sqlite:///")) as conn:
            assert conn.execute("SELECT count(*) FROM projects WHERE deleted_at IS NOT NULL").fetchone()[0] == 1
            assert conn.execute("SELECT count(*) FROM annotations WHERE deleted_at IS NOT NULL").fetchone()[0] == 1
            assert conn.execute("SELECT count(*) FROM exports").fetchone()[0] == 1


def test_database_keeps_bucket_and_folder_rules(db_client):
    pid = create_project(db_client)
    _put(db_client, pid, {"events": [_event()]})
    res = db_client.patch(f"/api/projects/{pid}", json={"storage": {"bucket": "another-bucket"}})
    assert res.status_code == 409 and res.json()["error"]["code"] == "BUCKET_HAS_ANNOTATIONS"
    db_client.patch(f"/api/projects/{pid}", json={"storage": {"prefix": "clips/set2/"}})
    stats = db_client.get(f"/api/projects/{pid}").json()["stats"]
    assert stats == {"completed": 0, "in_progress": 0, "total_events": 0, "all_annotated": 1}


def test_migrate_copies_local_projects_into_the_database(client, project, tmp_path):
    _put(client, project, {"status": "completed", "events": [_event()]})
    files = ProjectStore(tmp_path / "app_data")
    db = DatabaseStore(f"sqlite:///{tmp_path / 'migrated.db'}")
    try:
        assert migrate(files, db, log=lambda *_: None) == (1, 1)
        assert migrate(files, db, log=lambda *_: None) == (0, 0)  # second run skips it
        copied = db.get(project)
        assert copied.storage.secret_access_key == "s3cr3t-value-xyz" and copied.label_schema.event_types
        ann = db.get_annotation(project, KEY)
        assert ann.status == "completed" and len(ann.events) == 1
        assert db.stats(copied).completed == 1
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Sign-in
# --------------------------------------------------------------------------- #


@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, auth=True) as c:
        yield c


def test_every_endpoint_requires_sign_in(auth_client):
    assert auth_client.get("/api/health").status_code == 200  # public, holds no project data
    assert auth_client.get("/api/health").json()["auth"] is True

    missing = auth_client.get("/api/projects")
    assert missing.status_code == 401 and missing.json()["error"]["code"] == "AUTH_REQUIRED"
    garbage = auth_client.get("/api/projects", headers=bearer("not-a-token"))
    assert garbage.json()["error"]["code"] == "AUTH_INVALID"
    expired = auth_client.get("/api/projects", headers=bearer(make_token(expires_in=-3600)))
    assert expired.status_code == 401 and expired.json()["error"]["code"] == "AUTH_EXPIRED"
    forged = auth_client.get("/api/projects", headers=bearer(make_token(secret="x" * 40)))
    assert forged.json()["error"]["code"] == "AUTH_INVALID"
    # Supabase's public anon key is itself a JWT, but not a signed-in user.
    anon = auth_client.get("/api/projects", headers=bearer(make_token(aud="anon")))
    assert anon.json()["error"]["code"] == "AUTH_INVALID"
    other_project = auth_client.get("/api/projects", headers=bearer(make_token(issuer="https://evil.supabase.co/auth/v1")))
    assert other_project.json()["error"]["code"] == "AUTH_INVALID"

    ok = auth_client.get("/api/projects", headers=bearer(make_token()))
    assert ok.status_code == 200 and ok.json() == []
    assert auth_client.get("/api/review").status_code == 401  # outside /api/projects, still signed in only


def test_hosted_requests_are_not_limited_to_localhost(auth_client):
    res = auth_client.get("/api/projects", headers={**bearer(make_token()), "host": "lemon-api.onrender.com"})
    assert res.status_code == 200


def test_allowed_emails(tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, auth=True) as client:
        monkeypatch.setenv("LEMON_ALLOWED_EMAILS", "alex@example.com, Sam@Example.com")
        get_settings.cache_clear()
        assert client.get("/api/projects", headers=bearer(make_token(email="sam@example.com"))).status_code == 200
        denied = client.get("/api/projects", headers=bearer(make_token(email="mallory@example.com")))
        assert denied.status_code == 403 and denied.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_saves_record_who_made_them_and_presence_is_shared(auth_client):
    alex, sam = bearer(make_token("u-alex", "alex@example.com", "Alex")), bearer(make_token("u-sam", "sam@example.com", None))
    pid = create_project(auth_client, headers=alex)

    saved = _put(auth_client, pid, {"status": "completed", "events": [_event()], "base_revision": None}, headers=alex)
    assert saved.json()["updated_by"] == "Alex"
    queue = {v["key"]: v for v in auth_client.get(f"/api/projects/{pid}/videos", headers=sam).json()["videos"]}
    assert queue[KEY]["updated_by"] == "Alex"
    export = auth_client.post(f"/api/projects/{pid}/export", headers=sam).json()["data"]
    assert next(v for v in export["videos"] if v["s3_key"] == KEY)["annotated_by"] == "Alex"

    # Sam (no display name: falls back to the email name) saves on top of an old copy: told who saved.
    conflict = _put(auth_client, pid, {"events": [], "base_revision": None}, headers=sam)
    assert conflict.status_code == 409 and conflict.json()["error"]["message"].startswith("Alex saved")

    auth_client.post(f"/api/projects/{pid}/activity", json={"video_key": KEY}, headers=alex)
    seen_by_sam = auth_client.post(f"/api/projects/{pid}/activity", json={"video_key": None}, headers=sam).json()
    assert [(p["name"], p["video_key"]) for p in seen_by_sam["presence"]] == [("Alex", KEY)]
    seen_by_alex = auth_client.post(f"/api/projects/{pid}/activity", json={"video_key": KEY}, headers=alex).json()
    assert [(p["name"], p["video_key"]) for p in seen_by_alex["presence"]] == [("sam", None)]


def test_cors_allows_the_configured_site(tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, auth=True) as client:
        res = client.options("/api/projects", headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        assert res.status_code == 200 and res.headers["access-control-allow-origin"] == "http://localhost:3000"


# --------------------------------------------------------------------------- #
# Deploy guards
# --------------------------------------------------------------------------- #


def test_render_refuses_to_start_without_database_and_sign_in(tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, auth=True):
        monkeypatch.setenv("RENDER", "true")
        with pytest.raises(RuntimeError, match="LEMON_DATABASE_URL"):
            with TestClient(app):
                pass
    with app_client(tmp_path, monkeypatch, database=True):
        monkeypatch.setenv("RENDER", "true")
        with pytest.raises(RuntimeError, match="LEMON_SUPABASE_URL"):
            with TestClient(app):
                pass


def test_tokens_signed_with_supabase_signing_keys(tmp_path, monkeypatch):
    """Newer Supabase projects sign with ES256 keys published at /auth/v1/.well-known/jwks.json."""
    import time

    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec

    from app import auth

    private_key = ec.generate_private_key(ec.SECP256R1())

    class FakeJwks:
        def get_signing_key_from_jwt(self, token):
            if jwt.get_unverified_header(token).get("kid") != "key-1":
                raise jwt.PyJWKClientError("Unable to find a signing key that matches")
            return jwt.PyJWK.from_dict(jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
                                       | {"kid": "key-1", "alg": "ES256"})

    def token(kid="key-1", key=private_key):
        now = int(time.time())
        claims = {"sub": "u-1", "email": "alex@example.com", "aud": "authenticated", "exp": now + 600,
                  "iss": "https://test-project.supabase.co/auth/v1"}
        return jwt.encode(claims, key, algorithm="ES256", headers={"kid": kid})

    with app_client(tmp_path, monkeypatch, auth=True) as client:
        monkeypatch.setenv("LEMON_SUPABASE_JWT_SECRET", "")  # new projects: no shared secret
        get_settings.cache_clear()
        monkeypatch.setattr(auth, "_jwks_client", lambda url: FakeJwks())
        assert client.get("/api/projects", headers=bearer(token())).status_code == 200
        unknown_kid = client.get("/api/projects", headers=bearer(token(kid="rotated-away")))
        assert unknown_kid.status_code == 401
        other_key = client.get("/api/projects", headers=bearer(token(key=ec.generate_private_key(ec.SECP256R1()))))
        assert other_key.status_code == 401 and other_key.json()["error"]["code"] == "AUTH_INVALID"
        # A legacy HS256 token can't be checked without the secret: a clear server-side message.
        legacy = client.get("/api/projects", headers=bearer(make_token()))
        assert legacy.status_code == 500 and legacy.json()["error"]["code"] == "AUTH_MISCONFIGURED"


def test_clearing_refuses_a_version_the_user_has_not_seen(any_client, any_project):
    seen = _put(any_client, any_project, {"events": [_event()], "base_revision": None}).json()["revision"]
    newer = _put(any_client, any_project, {"events": [_event(), _event("b", 2)], "base_revision": seen}).json()

    stale = any_client.delete(f"/api/projects/{any_project}/annotations", params={"key": KEY, "revision": seen})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "CLEAR_CONFLICT"
    assert any_client.get(f"/api/projects/{any_project}/annotations", params={"key": KEY}).json()["event_count"] == 2

    # "I saw nothing saved" ('') is refused too once something is.
    blind = any_client.delete(f"/api/projects/{any_project}/annotations", params={"key": KEY, "revision": ""})
    assert blind.status_code == 409

    ok = any_client.delete(f"/api/projects/{any_project}/annotations", params={"key": KEY, "revision": newer["revision"]})
    assert ok.status_code == 200 and ok.json()["cleared"] is True
    # Nothing saved any more: nothing to protect, so any revision is fine (and nothing is cleared).
    again = any_client.delete(f"/api/projects/{any_project}/annotations", params={"key": KEY, "revision": seen})
    assert again.status_code == 200 and again.json()["cleared"] is False


def test_an_interrupted_migration_leaves_nothing_and_can_be_rerun(client, project, tmp_path, monkeypatch):
    for key in ("clips/rally_001.mp4", "clips/serve_003.mov"):
        _put(client, project, {"events": [_event()]}, key=key)
    files = ProjectStore(tmp_path / "app_data")
    db = DatabaseStore(f"sqlite:///{tmp_path / 'interrupted.db'}")
    try:
        real = db._annotation_values
        calls = {"n": 0}

        def fail_on_second(annotation):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("connection dropped")
            return real(annotation)

        monkeypatch.setattr(db, "_annotation_values", fail_on_second)
        with pytest.raises(RuntimeError):
            migrate(files, db, log=lambda *_: None)
        assert db.list_projects() == []  # rolled back: no half-copied project

        monkeypatch.setattr(db, "_annotation_values", real)
        assert migrate(files, db, log=lambda *_: None) == (1, 2)
    finally:
        db.close()
