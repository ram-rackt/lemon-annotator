"""Sign-in: every API request carries a Supabase access token (Authorization: Bearer ...).

Supabase signs tokens with asymmetric keys (ES256/RS256, public keys fetched from the project's JWKS
endpoint) or, on older projects, with a shared secret (HS256). Both are supported. With neither
LEMON_SUPABASE_URL nor LEMON_SUPABASE_JWT_SECRET set, sign-in is off and the app is local-only.
"""

import threading
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Request

from .config import Settings, get_settings
from .errors import AppError, AuthError


@dataclass(frozen=True)
class User:
    id: str
    email: str | None
    # Shown to teammates ("Alex saved this video"). None when sign-in is off.
    name: str | None


LOCAL_USER = User(id="local", email=None, name=None)

_jwks_lock = threading.Lock()


@lru_cache
def _jwks_client(supabase_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json", lifespan=600, timeout=10)


def _misconfigured(message: str, hint: str) -> AppError:
    return AppError(message, code="AUTH_MISCONFIGURED", status_code=500, hint=hint)


def verify_token(token: str, settings: Settings) -> dict:
    try:
        alg = jwt.get_unverified_header(token).get("alg")
    except jwt.InvalidTokenError as exc:
        raise AuthError("Your sign-in is not valid. Sign in again.", code="AUTH_INVALID") from exc

    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1" if settings.supabase_url else None
    try:
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise _misconfigured(
                    "The server cannot verify this sign-in.",
                    "Set LEMON_SUPABASE_JWT_SECRET to the project's legacy JWT secret "
                    "(Supabase > Project Settings > JWT Keys).",
                )
            key, algorithms = settings.supabase_jwt_secret, ["HS256"]
        elif alg in ("ES256", "RS256"):
            if not settings.supabase_url:
                raise _misconfigured("The server cannot verify this sign-in.", "Set LEMON_SUPABASE_URL.")
            with _jwks_lock:
                key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token).key
            algorithms = [alg]
        else:
            raise AuthError("Your sign-in is not valid. Sign in again.", code="AUTH_INVALID")
        return jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience="authenticated",
            issuer=issuer,
            leeway=30,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Your session has expired. Sign in again.", code="AUTH_EXPIRED") from exc
    except jwt.PyJWKClientConnectionError as exc:
        raise AppError(
            "Could not reach Supabase to verify your sign-in.",
            code="AUTH_UNAVAILABLE",
            status_code=503,
            hint="Try again in a moment.",
        ) from exc
    except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
        raise AuthError("Your sign-in is not valid. Sign in again.", code="AUTH_INVALID") from exc


def current_user(request: Request) -> User:
    """FastAPI dependency: the signed-in user (LOCAL_USER when sign-in is off)."""
    settings = get_settings()
    if not settings.auth_enabled:
        return LOCAL_USER
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError("Sign in to continue.", code="AUTH_REQUIRED")
    claims = verify_token(token.strip(), settings)

    email = claims.get("email") or None
    allowed = settings.allowed_email_set
    if allowed and (email or "").lower() not in allowed:
        raise AuthError(
            "This account is not allowed to use this Lemon workspace.",
            code="AUTH_FORBIDDEN",
            status_code=403,
            hint="Ask the owner to add your email to LEMON_ALLOWED_EMAILS.",
        )
    meta = claims.get("user_metadata") or {}
    name = meta.get("full_name") or meta.get("name") or (email.split("@")[0] if email else str(claims["sub"])[:8])
    return User(id=str(claims["sub"]), email=email, name=str(name)[:80])
