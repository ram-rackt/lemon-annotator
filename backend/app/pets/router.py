"""Where the two pets are, shared by their owners so each sees the other's pet move and play.

Only a pet's owner can move it. Every other account gets a 404, as if the feature didn't exist. Kept in
memory like presence: after a restart both pets are back home. (Lemon runs as a single server process.)
"""

import secrets
import threading
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from ..auth import User, current_user
from ..config import BACKEND_DIR
from ..errors import AppError, NotFoundError
from ..models import utcnow

PetKind = Literal["cat", "dog"]
# home: its own corner (cat bottom-right, dog bottom-left). free: where its owner dropped it.
# with: beside the other pet (following it), until its owner sends it home or drags it away.
Spot = Literal["home", "free", "with"]


class PetSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_prefix="LEMON_", extra="ignore")

    # email:pet pairs, comma-separated.
    pet_owners: str = "ankana@rackt.in:cat,ram@rackt.in:dog"


def owners() -> dict[str, PetKind]:
    pairs = (item.split(":", 1) for item in PetSettings().pet_owners.split(",") if ":" in item)
    return {email.strip().lower(): pet.strip() for email, pet in pairs if pet.strip() in ("cat", "dog")}  # type: ignore[misc]


class PetState(BaseModel):
    spot: Spot = "home"
    # free: where in the window, as fractions of the room the pet can move in (0 = left / top, 1 = right /
    # bottom), so it lands in the same place on any screen size.
    x: float | None = None
    y: float | None = None
    moved_at: datetime | None = None
    moved_by: str | None = None


class Play(BaseModel):
    """The latest time a pet went to the other: both screens start the same activity (picked with `seed`)."""

    at: datetime | None = None
    seed: int = 0


class PetsResult(BaseModel):
    you: PetKind
    # Server time of this snapshot, so both screens agree on timing without trusting their clocks.
    now: datetime
    cat: PetState
    dog: PetState
    play: Play


class PetMove(BaseModel):
    spot: Spot
    x: float | None = Field(None, ge=0, le=1)
    y: float | None = Field(None, ge=0, le=1)

    @model_validator(mode="after")
    def _where(self) -> "PetMove":
        if self.spot == "free" and (self.x is None or self.y is None):
            raise ValueError("A free spot needs x and y")
        if self.spot != "free":
            self.x = self.y = None
        return self


router = APIRouter(prefix="/api/pets", tags=["pets"])

_lock = threading.Lock()
_pets: dict[PetKind, PetState] = {"cat": PetState(), "dog": PetState()}
_play = {"latest": Play()}


def your_pet(user: User) -> PetKind:
    pet = owners().get((user.email or "").lower())
    if not pet:
        raise NotFoundError("Not found")
    return pet


def snapshot(you: PetKind) -> PetsResult:
    with _lock:
        return PetsResult(you=you, now=utcnow(), cat=_pets["cat"], dog=_pets["dog"], play=_play["latest"])


@router.get("", response_model=PetsResult)
def get_pets(user: User = Depends(current_user)):
    return snapshot(your_pet(user))


@router.put("/{pet}", response_model=PetsResult)
def move_pet(pet: PetKind, body: PetMove, user: User = Depends(current_user)):
    you = your_pet(user)
    if pet != you:
        raise AppError(f"Only the {pet}'s owner can move it.", code="NOT_YOUR_PET", status_code=403)
    other: PetKind = "dog" if pet == "cat" else "cat"
    now = utcnow()
    with _lock:
        if body.spot == "with":
            # Already together (the other pet is beside this one): nobody moves, they just play again.
            # This also means the two are never both following each other.
            if _pets[other].spot != "with":
                _pets[pet] = PetState(spot="with", moved_at=now, moved_by=user.name)
            _play["latest"] = Play(at=now, seed=secrets.randbelow(1_000_000))
        else:
            _pets[pet] = PetState(spot=body.spot, x=body.x, y=body.y, moved_at=now, moved_by=user.name)
    return snapshot(you)


def clear() -> None:
    with _lock:
        _pets.update({"cat": PetState(), "dog": PetState()})
        _play["latest"] = Play()
