"""Workspaces (LEMON_TEAMS) and coaches (LEMON_COACHES)."""

import pytest

from app.access import claim_unowned_projects
from app.config import parse_teams
from app.deps import get_store
from conftest import BUCKET, STORAGE, app_client, bearer, create_project, make_token

RAM = bearer(make_token("u-ram", "ram@rackt.in", "Ram"))
ANKANA = bearer(make_token("u-ankana", "Ankana@Rackt.in", "Ankana"))  # emails match case-insensitively
PAT = bearer(make_token("u-pat", "pat@example.com", "Pat"))
COACH = bearer(make_token("u-coach", "coach@example.com", "Coach"))

REVIEW_SCHEMA = {"event_types": [], "fields": [
    {"key": "flagged_for_review", "label": "Flagged for Review", "type": "choices", "options": ["true", "false"],
     "scope": "video"},
    {"key": "rotation", "label": "Rotation", "type": "choices", "options": ["0", "90"], "scope": "video"},
]}
FLAGGED, OTHER = "clips/rally_001.mp4", "clips/serve_003.mov"


@pytest.fixture(params=["files", "database"])
def ws_client(request, tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, database=request.param == "database", auth=True,
                    teams="rackt: ram@rackt.in, ankana@rackt.in", coaches="coach@example.com") as c:
        yield c


def _save(client, pid, key, headers, **labels):
    res = client.put(f"/api/projects/{pid}/annotations", params={"key": key}, headers=headers,
                     json={"labels": labels, "events": []})
    assert res.status_code == 200, res.text
    return res.json()


def test_workspaces_are_separate(ws_client):
    client = ws_client
    team_project = create_project(client, headers=RAM)
    own_project = create_project(client, headers=PAT)

    # Ram and Ankana share the team's projects; Pat only sees their own.
    assert [p["id"] for p in client.get("/api/projects", headers=ANKANA).json()] == [team_project]
    assert [p["id"] for p in client.get("/api/projects", headers=PAT).json()] == [own_project]
    _save(client, team_project, FLAGGED, ANKANA)
    assert client.get(f"/api/projects/{team_project}/annotations", params={"key": FLAGGED}, headers=RAM).json()

    # To Pat, the team's project doesn't exist, whatever they try.
    base = f"/api/projects/{team_project}"
    for method, path, kwargs in [
        ("get", "", {}),
        ("patch", "", {"json": {"name": "mine now"}}),
        ("delete", "", {}),
        ("post", "/storage/test", {}),
        ("get", "/videos", {}),
        ("post", "/sync", {}),
        ("get", "/videos/stream-url", {"params": {"key": FLAGGED}}),
        ("get", "/annotations", {"params": {"key": FLAGGED}}),
        ("put", "/annotations", {"params": {"key": FLAGGED}, "json": {"events": []}}),
        ("delete", "/annotations", {"params": {"key": FLAGGED}}),
        ("post", "/activity", {"json": {"video_key": None}}),
        ("get", "/review", {}),
        ("post", "/export", {}),
    ]:
        res = getattr(client, method)(base + path, headers=PAT, **kwargs)
        assert res.status_code == 404, (method, path, res.status_code)
    assert client.get(f"/api/projects/{team_project}", headers=RAM).json()["name"] == "Badminton"


def test_coach_sees_only_flagged_videos(ws_client):
    client = ws_client
    pid = create_project(client, headers=RAM)
    client.patch(f"/api/projects/{pid}", json={"label_schema": REVIEW_SCHEMA}, headers=RAM)
    _save(client, pid, FLAGGED, RAM, flagged_for_review="true", rotation="90")
    _save(client, pid, OTHER, ANKANA, flagged_for_review="false")
    base = f"/api/projects/{pid}"

    # The coach's own workspace is empty; Coach review lists the team's flagged video.
    assert client.get("/api/projects", headers=COACH).json() == []
    review = client.get("/api/review", headers=COACH).json()
    assert [(p["project_id"], [v["key"] for v in p["videos"]]) for p in review] == [(pid, [FLAGGED])]
    # Someone outside the team, not a coach, doesn't get it.
    assert client.get("/api/review", headers=PAT).json() == []

    # The project as a coach sees it: labels and player settings, no storage or progress.
    project = client.get(base, headers=COACH).json()
    assert project["access"] == "coach" and project["label_schema"]["fields"][0]["key"] == "flagged_for_review"
    assert project["storage"]["bucket"] == "" and project["storage"]["is_configured"] is True
    assert project["stats"]["all_annotated"] == 0 and project["last_sync"] is None
    assert client.get(base, headers=RAM).json()["access"] == "member"

    # The queue holds only the flagged video, without the bucket.
    queue = client.get(f"{base}/videos", headers=COACH).json()
    assert [v["key"] for v in queue["videos"]] == [FLAGGED] and queue["bucket"] == ""
    activity = client.post(f"{base}/activity", json={"video_key": FLAGGED}, headers=COACH).json()
    assert list(activity["videos"]) == [FLAGGED]
    # Members see the coach on the video.
    seen = client.post(f"{base}/activity", json={"video_key": None}, headers=RAM).json()
    assert [(p["name"], p["video_key"]) for p in seen["presence"]] == [("Coach", FLAGGED)]

    # The flagged video can be played, read and changed...
    assert client.get(f"{base}/videos/stream-url", params={"key": FLAGGED, "verify": False}, headers=COACH).json()["url"]
    current = client.get(f"{base}/annotations", params={"key": FLAGGED}, headers=COACH).json()
    edited = client.put(f"{base}/annotations", params={"key": FLAGGED}, headers=COACH, json={
        "labels": {"flagged_for_review": "true", "rotation": "0"}, "events": [], "base_revision": current["revision"],
    })
    assert edited.status_code == 200 and edited.json()["updated_by"] == "Coach"
    # ...other videos can't.
    for method, path, kwargs in [
        ("get", "/videos/stream-url", {"params": {"key": OTHER}}),
        ("get", "/annotations", {"params": {"key": OTHER}}),
        ("put", "/annotations", {"params": {"key": OTHER}, "json": {"events": []}}),
    ]:
        res = getattr(client, method)(base + path, headers=COACH, **kwargs)
        assert res.status_code == 404 and res.json()["error"]["code"] == "NOT_FLAGGED_FOR_REVIEW", path
    # Nor anything else in the project.
    for method, path, kwargs in [
        ("patch", "", {"json": {"name": "x"}}),
        ("delete", "", {}),
        ("post", "/sync", {}),
        ("get", "/videos/details", {"params": {"key": FLAGGED}}),
        ("delete", "/annotations", {"params": {"key": FLAGGED}}),
        ("post", "/export", {}),
    ]:
        res = getattr(client, method)(base + path, headers=COACH, **kwargs)
        assert res.status_code == 404 and res.json()["error"]["code"] == "NOT_FOUND", (method, path)

    # Done: the flag is cleared, and the video is out of the coach's reach again.
    done = client.post(f"{base}/review/done", params={"key": FLAGGED}, headers=COACH).json()
    assert done["labels"] == {"flagged_for_review": "false", "rotation": "0"}
    assert client.get(f"{base}/videos", headers=COACH).json()["videos"] == []
    assert client.get(f"{base}/annotations", params={"key": FLAGGED}, headers=COACH).status_code == 404
    assert client.get(f"{base}/annotations", params={"key": FLAGGED}, headers=RAM).json()["updated_by"] == "Coach"


def test_coach_projects_stay_private(ws_client):
    """A coach is a member of their own workspace like anyone else; teams don't see into it."""
    client = ws_client
    pid = create_project(client, headers=COACH)
    assert [p["id"] for p in client.get("/api/projects", headers=COACH).json()] == [pid]
    assert client.get(f"/api/projects/{pid}", headers=COACH).json()["access"] == "member"
    assert client.get(f"/api/projects/{pid}", headers=RAM).status_code == 404


def test_projects_from_before_workspaces_go_to_the_first_team(tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, database=True) as client:  # sign-in off, like the old setup
        old = create_project(client)
    with app_client(tmp_path, monkeypatch, database=True, auth=True, teams="rackt: ram@rackt.in; b: x@y.z") as client:
        # Until claimed (at startup), an unowned project is shared by everyone signed in.
        assert [p["id"] for p in client.get("/api/projects", headers=PAT).json()] == [old]
        assert claim_unowned_projects(get_store()) == 1
        assert claim_unowned_projects(get_store()) == 0  # once only
        assert [p["id"] for p in client.get("/api/projects", headers=RAM).json()] == [old]
        assert client.get("/api/projects", headers=PAT).json() == []
        assert client.get(f"/api/projects/{old}", headers=RAM).json()["storage"]["bucket"] == BUCKET


def test_teams_setting_is_checked():
    assert parse_teams(" Rackt : A@x.com, b@x.com ; solo: c@y.com ") == [("rackt", ["a@x.com", "b@x.com"]),
                                                                        ("solo", ["c@y.com"])]
    assert parse_teams("") == []
    for bad in ["ram@rackt.in", "rackt:", ": a@x.com", "a: x@y.z; b: x@y.z", "a: x@y.z; a: q@y.z"]:
        with pytest.raises(ValueError):
            parse_teams(bad)


def test_signed_out_and_local_setups_are_unchanged(client):
    """Without sign-in (local, single user), every project is visible as before."""
    pid = create_project(client)
    assert [p["id"] for p in client.get("/api/projects").json()] == [pid]
    assert client.get(f"/api/projects/{pid}").json()["access"] == "member"
    assert client.patch(f"/api/projects/{pid}", json={"storage": STORAGE}).status_code == 200
