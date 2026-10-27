import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .auth import current_user
from .config import get_settings
from .db_store import DatabaseStore
from .deps import get_store
from .errors import AppError
from .routers import export, projects, videos

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("lemon")

settings = get_settings()


def _check_deployment() -> None:
    """Refuse to start on a hosted server in a setup that would lose data or be unreachable."""
    if not os.environ.get("RENDER"):
        return
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError(
            "LEMON_DATABASE_URL is not set. Render's disk is wiped on every deploy, so Lemon needs the "
            "Supabase database there. Add it under Environment in the Render dashboard."
        )
    if not settings.auth_enabled:
        raise RuntimeError("LEMON_SUPABASE_URL is not set. A hosted Lemon must require sign-in.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    _check_deployment()
    store = get_store()
    log.info("Storage: %s, sign-in %s", store.root, "required" if get_settings().auth_enabled else "off (local only)")
    yield


app = FastAPI(title="Lemon API", version=__version__, lifespan=lifespan)

def _hostname(host: str) -> str:
    host = host.strip().lower()
    if host.startswith("["):  # [::1]:8000
        return host[1 : host.find("]")]
    return host.split(":")[0]


@app.middleware("http")
async def only_local_hosts(request: Request, call_next):
    """Without sign-in, reject requests whose Host header isn't this machine, so a malicious web page
    can't reach the API through DNS rebinding. With sign-in, every request needs a valid token instead."""
    current = get_settings()
    hosts = current.allowed_host_set
    if not current.auth_enabled and "*" not in hosts and _hostname(request.headers.get("host", "")) not in hosts:
        return JSONResponse(
            status_code=403,
            content={"error": {"code": "FORBIDDEN_HOST", "message": "Lemon only accepts requests from this computer.",
                               "hint": "Set LEMON_ALLOWED_HOSTS if you really need another host name.", "details": {}}},
        )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600,
)


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError):
    if exc.status_code >= 500:
        log.error("%s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.to_dict()})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    errors = exc.errors()
    first = errors[0] if errors else {}
    location = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    message = first.get("msg", "Invalid request").removeprefix("Value error, ")
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": f"{location}: {message}" if location else message,
                "hint": None,
                "details": {"errors": [{"loc": e.get("loc"), "msg": e.get("msg")} for e in errors]},
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception):
    log.exception("Unhandled error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": str(exc) or "Internal server error",
                           "hint": "See the API logs for the stack trace.", "details": {}}},
    )


@app.get("/api/health")
def health():
    """Public: used by the dev runner and Render's health check. Contains no project data."""
    store = get_store()
    return {
        "ok": True,
        "version": __version__,
        "data_dir": str(store.root),
        "storage": "database" if isinstance(store, DatabaseStore) else "files",
        "auth": get_settings().auth_enabled,
    }


# Every other endpoint requires a signed-in user (when sign-in is configured).
signed_in = [Depends(current_user)]
app.include_router(projects.router, dependencies=signed_in)
app.include_router(videos.router, dependencies=signed_in)
app.include_router(export.router, dependencies=signed_in)
app.include_router(videos.review_router, dependencies=signed_in)
