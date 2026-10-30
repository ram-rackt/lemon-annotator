"""The two pets: only their owners see them, each moves only their own, and both see every move."""

import pytest

from app.pets import router as pets

from conftest import app_client, bearer, make_token

CAT_OWNER = bearer(make_token(sub="u-ankana", email="ankana@rackt.in", name="ankana"))
DOG_OWNER = bearer(make_token(sub="u-ram", email="Ram@Rackt.in", name="ram"))
SOMEONE = bearer(make_token(sub="u-kim", email="kim@rackt.in", name="kim"))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LEMON_PET_OWNERS", "ankana@rackt.in:cat, ram@rackt.in:dog")
    pets.clear()
    with app_client(tmp_path, monkeypatch, auth=True) as c:
        yield c
    pets.clear()


def move(client, pet, headers, **body):
    return client.put(f"/api/pets/{pet}", json=body, headers=headers)


def test_only_the_owners_see_the_pets(client):
    assert client.get("/api/pets").status_code == 401
    assert client.get("/api/pets", headers=SOMEONE).status_code == 404
    mine = client.get("/api/pets", headers=CAT_OWNER).json()
    assert mine["you"] == "cat" and mine["cat"]["spot"] == "home" and mine["dog"]["spot"] == "home"
    assert mine["play"] == {"at": None, "seed": 0}
    assert client.get("/api/pets", headers=DOG_OWNER).json()["you"] == "dog"  # emails match in any case


def test_each_owner_moves_only_their_pet_and_both_see_it(client):
    dropped = move(client, "cat", CAT_OWNER, spot="free", x=0.25, y=0.5).json()["cat"]
    assert (dropped["spot"], dropped["x"], dropped["y"]) == ("free", 0.25, 0.5)
    seen_by_ram = client.get("/api/pets", headers=DOG_OWNER).json()["cat"]
    assert seen_by_ram["spot"] == "free" and seen_by_ram["moved_by"] == "ankana"

    refused = move(client, "cat", DOG_OWNER, spot="home")
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "NOT_YOUR_PET"
    assert move(client, "dog", SOMEONE, spot="home").status_code == 404
    assert move(client, "dog", DOG_OWNER, spot="free").status_code == 422  # where?
    assert move(client, "dog", DOG_OWNER, spot="free", x=1.5, y=0).status_code == 422  # outside the window


def test_going_to_the_other_pet_starts_a_shared_play(client):
    joined = move(client, "dog", DOG_OWNER, spot="with").json()
    assert joined["dog"]["spot"] == "with" and joined["play"]["at"]
    seen_by_ankana = client.get("/api/pets", headers=CAT_OWNER).json()
    assert seen_by_ankana["play"] == joined["play"]  # both screens play the same activity

    # The dog is already beside the cat: clicking the cat makes them play again, nobody follows anybody.
    again = move(client, "cat", CAT_OWNER, spot="with").json()
    assert again["cat"]["spot"] == "home" and again["dog"]["spot"] == "with"
    assert again["play"]["at"] > joined["play"]["at"]

    # Double-click: home again, the play is not repeated.
    home = move(client, "dog", DOG_OWNER, spot="home").json()
    assert home["dog"]["spot"] == "home" and home["play"] == again["play"]


def test_without_sign_in_there_are_no_pets(tmp_path, monkeypatch):
    pets.clear()
    with app_client(tmp_path, monkeypatch) as c:  # local mode: nobody is signed in
        assert c.get("/api/pets").status_code == 404
