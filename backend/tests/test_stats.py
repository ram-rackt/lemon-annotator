"""The home page's shot type counts."""

from conftest import app_client, bearer, create_project, make_token

RAM = bearer(make_token("u-ram", "ram@example.com", "Ram"))
PAT = bearer(make_token("u-pat", "pat@example.com", "Pat"))
COACH = bearer(make_token("u-coach", "coach@example.com", "Coach"))

SHOT_SCHEMA = {"event_types": [], "fields": [
    {"key": "shot_type", "label": "Shot Type", "type": "choices", "scope": "video",
     "options": ["backhand_cross_clear", "forehand_straight_clear", "Forehand Smash"]},
    {"key": "camera_angle", "label": "Camera Angle", "type": "choices", "options": ["front", "back"], "scope": "video"},
]}


def _project(client, headers=None, name="Rear court"):
    pid = create_project(client, headers=headers)
    res = client.patch(f"/api/projects/{pid}", json={"name": name, "label_schema": SHOT_SCHEMA}, headers=headers)
    assert res.status_code == 200, res.text
    return pid


def _save(client, pid, key, status="completed", headers=None, **labels):
    res = client.put(f"/api/projects/{pid}/annotations", params={"key": key}, headers=headers,
                     json={"status": status, "labels": labels, "events": []})
    assert res.status_code == 200, res.text


def test_counts_completed_videos_per_shot_type(any_client):
    client = any_client
    rear, front = _project(client, name="Rear court"), _project(client, name="Front court")
    _save(client, rear, "clips/rally_001.mp4", shot_type="backhand_cross_clear")
    _save(client, rear, "clips/serve_003.mov", shot_type="forehand_straight_clear")
    _save(client, front, "clips/rally_001.mp4", shot_type="backhand_cross_clear")
    _save(client, front, "clips/set2/RALLY_002.MP4", shot_type="Forehand Smash")
    # Not counted: not completed yet; completed without a shot type is counted apart.
    _save(client, front, "clips/serve_003.mov", status="in_progress", shot_type="backhand_cross_clear")
    _save(client, rear, "clips/set2/RALLY_002.MP4", camera_angle="front")

    data = client.get("/api/stats/shot-types").json()
    assert data["available"] and data["completed"] == 5 and data["without_shot_type"] == 1
    assert [(s["label"], s["count"]) for s in data["shot_types"]] == [
        ("Backhand Cross Clear", 2), ("Forehand Smash", 1), ("Forehand Straight Clear", 1)]
    assert {p["project_name"] for p in data["shot_types"][0]["projects"]} == {"Rear court", "Front court"}

    # A video deleted from Lemon no longer counts.
    res = client.request("DELETE", f"/api/projects/{rear}/videos", params={"key": "clips/serve_003.mov"})
    assert res.status_code == 200, res.text
    labels = [s["label"] for s in client.get("/api/stats/shot-types").json()["shot_types"]]
    assert "Forehand Straight Clear" not in labels


def test_team_members_and_coaches_see_it(tmp_path, monkeypatch):
    with app_client(tmp_path, monkeypatch, auth=True, teams="rackt: ram@example.com",
                    coaches="coach@example.com") as client:
        team = _project(client, headers=RAM)
        own = _project(client, headers=PAT)
        _save(client, team, "clips/rally_001.mp4", headers=RAM, shot_type="backhand_cross_clear")
        _save(client, own, "clips/rally_001.mp4", headers=PAT, shot_type="Forehand Smash")

        # The team's projects only: never someone's private workspace.
        for who in (RAM, COACH):
            data = client.get("/api/stats/shot-types", headers=who).json()
            assert data["available"] and [s["label"] for s in data["shot_types"]] == ["Backhand Cross Clear"]
        assert client.get("/api/stats/shot-types", headers=PAT).json() == {
            "available": False, "completed": 0, "without_shot_type": 0, "shot_types": []}
        assert client.get("/api/stats/shot-types").status_code == 401
