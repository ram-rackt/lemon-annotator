import os
import time
from contextlib import contextmanager

import boto3
import jwt
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

from app import deps, presence, s3_service
from app.auth import _jwks_client
from app.config import get_settings
from app.db_store import DatabaseStore
from app.main import app

BUCKET = "test-videos"
SUPABASE_URL = "https://test-project.supabase.co"
JWT_SECRET = "test-secret-for-hs256-tokens-0123456789"

# Set this to run the database tests against a real Postgres instead of SQLite.
# WARNING: the `lemon` schema in that database is dropped before every test.
TEST_DATABASE_URL = os.environ.get("LEMON_TEST_DATABASE_URL", "")


def _reset_caches():
    get_settings.cache_clear()
    deps.get_store.cache_clear()
    _jwks_client.cache_clear()
    s3_service._clients.clear()
    presence.clear()


def _wipe_postgres(url: str) -> None:
    import psycopg

    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS lemon CASCADE")


@contextmanager
def app_client(tmp_path, monkeypatch, *, database: bool = False, auth: bool = False, teams: str = "", coaches: str = ""):
    """API client backed by an in-memory S3 (moto) and either a temp ./app_data folder or a database.
    Every LEMON_* setting is set explicitly so a developer's backend/.env never leaks into tests."""
    db_url = ""
    if database:
        db_url = TEST_DATABASE_URL or f"sqlite:///{tmp_path / 'lemon.db'}"
        if TEST_DATABASE_URL:
            _wipe_postgres(TEST_DATABASE_URL)
    env = {
        "LEMON_DATA_DIR": str(tmp_path / "app_data"),
        "LEMON_ALLOWED_HOSTS": "testserver,localhost,127.0.0.1",
        "LEMON_DATABASE_URL": db_url,
        "LEMON_SUPABASE_URL": SUPABASE_URL if auth else "",
        "LEMON_SUPABASE_JWT_SECRET": JWT_SECRET if auth else "",
        "LEMON_ALLOWED_EMAILS": "",
        "LEMON_TEAMS": teams,
        "LEMON_COACHES": coaches,
    }
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("RENDER", raising=False)
    _reset_caches()
    try:
        with mock_aws():
            s3 = boto3.client("s3", region_name="us-east-1")
            s3.create_bucket(Bucket=BUCKET)
            for key in [
                "clips/rally_001.mp4",
                "clips/set2/RALLY_002.MP4",
                "clips/serve_003.mov",
                "clips/old.mkv",
                "clips/notes.txt",
                "other/outside.mp4",
            ]:
                s3.put_object(Bucket=BUCKET, Key=key, Body=b"\x00" * 16)
            yield TestClient(app)
    finally:
        store = deps.get_store() if deps.get_store.cache_info().currsize else None
        if isinstance(store, DatabaseStore):
            store.close()
        _reset_caches()


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Local mode: JSON files, no sign-in."""
    with app_client(tmp_path, monkeypatch) as c:
        yield c


@pytest.fixture(params=["files", "database"])
def any_client(request, tmp_path, monkeypatch):
    """The same tests against both stores."""
    with app_client(tmp_path, monkeypatch, database=request.param == "database") as c:
        yield c


@pytest.fixture
def db_client(tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, database=True) as c:
        yield c


def make_token(sub="user-1", email="alex@example.com", name="Alex", *, expires_in=3600, aud="authenticated",
               secret=JWT_SECRET, issuer=f"{SUPABASE_URL}/auth/v1"):
    """A Supabase-style access token signed with the legacy HS256 secret."""
    now = int(time.time())
    claims = {"sub": sub, "email": email, "aud": aud, "role": "authenticated", "iat": now, "exp": now + expires_in,
              "iss": issuer, "user_metadata": {"full_name": name} if name else {}}
    return jwt.encode(claims, secret, algorithm="HS256")


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


SCHEMA = {
    "event_types": ["Smash", "Drop"],
    "fields": [
        {"key": "forehand", "label": "Forehand", "type": "checkbox", "options": [], "default": False},
        {"key": "winning_shot", "label": "Winning Shot", "type": "checkbox", "options": [], "default": False},
        {"key": "side", "label": "Side", "type": "select", "options": ["Left", "Right"], "default": None},
    ],
}

STORAGE = {"bucket": BUCKET, "prefix": "clips/", "access_key_id": "testing", "secret_access_key": "s3cr3t-value-xyz"}


def create_project(client, headers=None) -> str:
    pid = client.post("/api/projects", json={"name": "Badminton"}, headers=headers).json()["id"]
    res = client.patch(f"/api/projects/{pid}", json={"storage": STORAGE, "label_schema": SCHEMA}, headers=headers)
    assert res.status_code == 200, res.text
    return pid


@pytest.fixture
def project(client):
    return create_project(client)


@pytest.fixture
def any_project(any_client):
    return create_project(any_client)
