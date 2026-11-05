"""AWS keys a user has saved storage settings with, to fill in again in other projects.

Every key belongs to the signed-in user who used it (by their account id): nobody else can list or use
it. Only the Access Key ID is ever returned; the secret stays on the server.
"""

from fastapi import APIRouter, Depends, Query

from ..auth import User, current_user
from ..deps import Store, get_store
from ..errors import ValidationError
from ..models import SavedKey, SavedKeyPublic, StorageUpdate, utcnow

router = APIRouter(prefix="/api/saved-keys", tags=["saved keys"])


@router.get("", response_model=list[SavedKeyPublic])
def list_saved_keys(user: User = Depends(current_user), store: Store = Depends(get_store)):
    """The signed-in user's saved keys, most recently used first."""
    keys = sorted(store.list_saved_keys(user.id), key=lambda k: k.last_used_at, reverse=True)
    return [SavedKeyPublic(access_key_id=k.access_key_id, last_used_at=k.last_used_at) for k in keys]


@router.delete("")
def forget_saved_key(
    access_key_id: str = Query(..., min_length=1),
    user: User = Depends(current_user),
    store: Store = Depends(get_store),
):
    """Forget one of the user's saved keys (projects already using it keep working)."""
    store.forget_key(user.id, access_key_id)
    return {"ok": True}


def with_saved_secret(update: StorageUpdate, user: User, store: Store) -> StorageUpdate:
    """`use_saved_secret`: fill in the secret this user saved for that Access Key ID."""
    if not update.use_saved_secret:
        return update
    saved = store.get_saved_key(user.id, update.access_key_id or "")
    if not saved:
        raise ValidationError(
            "That saved key is no longer available.",
            code="SAVED_KEY_NOT_FOUND",
            hint="Enter the Secret Access Key again.",
        )
    fields = update.model_dump(exclude_unset=True, exclude={"use_saved_secret"})
    return StorageUpdate(**{**fields, "secret_access_key": saved.secret_access_key})


def remember_key(update: StorageUpdate, user: User, store: Store) -> None:
    """After storage settings were saved with a key pair: keep it (or note it was used again) for this user."""
    if update.access_key_id and update.secret_access_key:
        store.save_key(
            user.id,
            SavedKey(
                access_key_id=update.access_key_id,
                secret_access_key=update.secret_access_key,
                last_used_at=utcnow(),
            ),
        )
