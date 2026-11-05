"""Saved AWS keys: kept per user, reusable in other projects, the secret never sent back."""

import pytest

from conftest import BUCKET, STORAGE, app_client, bearer, create_project, make_token

RAM = bearer(make_token("u-ram", "ram@rackt.in", "Ram"))
ANKANA = bearer(make_token("u-ankana", "ankana@rackt.in", "Ankana"))


@pytest.fixture(params=["files", "database"])
def team(request, tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, database=request.param == "database", auth=True,
                    teams="rackt: ram@rackt.in, ankana@rackt.in") as c:
        yield c


def test_saved_keys_are_per_user_and_reusable(team):
    client = team
    create_project(client, headers=RAM)  # saves STORAGE's key pair: remembered for Ram

    listed = client.get("/api/saved-keys", headers=RAM).json()
    assert [k["access_key_id"] for k in listed] == [STORAGE["access_key_id"]]
    assert "s3cr3t" not in str(listed) and set(listed[0]) == {"access_key_id", "last_used_at"}
    # Ankana shares the workspace, but not Ram's keys.
    assert client.get("/api/saved-keys", headers=ANKANA).json() == []

    # Ram connects a new project with the saved key, without typing the secret.
    other = client.post("/api/projects", json={"name": "Second"}, headers=RAM).json()["id"]
    body = {"bucket": BUCKET, "prefix": "clips/", "region": "us-east-1", "access_key_id": STORAGE["access_key_id"],
            "use_saved_secret": True}
    tested = client.post(f"/api/projects/{other}/storage/test", json=body, headers=RAM)
    assert tested.status_code == 200 and tested.json()["video_count"] == 3
    saved = client.patch(f"/api/projects/{other}", json={"storage": body}, headers=RAM).json()["storage"]
    assert saved["access_key_id"] == STORAGE["access_key_id"] and saved["has_secret_access_key"] is True
    assert client.get(f"/api/projects/{other}/videos", headers=RAM).status_code == 200

    # Ankana can't use Ram's saved key, even knowing its ID.
    third = client.post("/api/projects", json={"name": "Third"}, headers=ANKANA).json()["id"]
    refused = client.post(f"/api/projects/{third}/storage/test", json=body, headers=ANKANA)
    assert refused.status_code == 400 and refused.json()["error"]["code"] == "SAVED_KEY_NOT_FOUND"

    # Forgetting it: gone from the list; projects already using it keep working.
    assert client.request("DELETE", "/api/saved-keys", params={"access_key_id": STORAGE["access_key_id"]},
                          headers=RAM).status_code == 200
    assert client.get("/api/saved-keys", headers=RAM).json() == []
    assert client.get(f"/api/projects/{other}/videos", headers=RAM).status_code == 200


def test_saved_keys_need_sign_in(tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, auth=True) as client:
        assert client.get("/api/saved-keys").status_code == 401


def test_new_projects_default_to_ap_south_1(client):
    pid = client.post("/api/projects", json={"name": "Fresh"}).json()["id"]
    assert client.get(f"/api/projects/{pid}").json()["storage"]["region"] == "ap-south-1"
    # An empty region on save falls back to it too.
    saved = client.patch(f"/api/projects/{pid}", json={"storage": {"bucket": "b", "region": ""}}).json()
    assert saved["storage"]["region"] == "ap-south-1"
