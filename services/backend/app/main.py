import asyncio
import contextlib
import importlib
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from app import telemetry
from app.api import (
    auth,
    integrations,
    meetings,
    privacy,
    profiles,
    projects,
    search,
    setup,
    speakers,
    standup,
    summaries,
    usage,
)
from app.api.auth import dev_login_enabled
from app.services import services
from app.ws import meetings as ws_meetings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.privacy.service import retention_loop
    from app.readiness import check_startup

    check_startup()
    # Load the LLM client library now (about 2 s): otherwise the first live call pays it inside
    # its 1.5 s budget and question detection times out. Skipped with the fake providers.
    if os.environ.get("COPILOT_FAKE_PROVIDERS") != "1":
        await asyncio.to_thread(importlib.import_module, "litellm")
    retention = (
        asyncio.create_task(retention_loop(services))
        if os.environ.get("COPILOT_RETENTION_JOB", "1") == "1"
        else None
    )
    yield
    if retention:
        retention.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await retention
    # Flush live meetings' transcripts on shutdown.
    s = services()
    await s.sessions.shutdown()
    close = getattr(s.meetings, "close", None)
    if close:
        await close()


app = FastAPI(title="Meeting Copilot backend", version="0.1.0", lifespan=lifespan)
telemetry.setup(app)


def web_origins() -> list[str]:
    """Origins of the web app allowed to call this backend from a browser (comma-separated
    COPILOT_WEB_ORIGINS, e.g. "https://meeting-copilot.vercel.app"). None by default; the
    desktop and phone apps don't need CORS."""
    raw = os.environ.get("COPILOT_WEB_ORIGINS", "")
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


if web_origins():
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=web_origins(),
        allow_credentials=False,  # the backend token is sent as a header, never a cookie
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "traceparent"],
        max_age=600,
    )
app.include_router(auth.router)
app.include_router(usage.router)
app.include_router(meetings.router)
app.include_router(summaries.router)
app.include_router(search.router)
app.include_router(speakers.router)
app.include_router(profiles.router)
app.include_router(standup.router)
app.include_router(projects.router)
app.include_router(privacy.router)
app.include_router(integrations.router)
app.include_router(setup.router)
app.include_router(ws_meetings.router)


@app.middleware("http")
async def security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Cache-Control", "no-store")
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return response


@app.get("/ready")
async def ready() -> JSONResponse:
    """Readiness: the database answers (when one is configured). For load balancers and deploys."""
    s = services()
    connection = getattr(s.meetings, "connection", None)
    if connection is not None:
        try:
            async with await connection() as conn:
                await conn.execute("select 1")
        except Exception as e:  # noqa: BLE001 - any failure means not ready
            logging.getLogger("app.readiness").warning("database not ready: %s", type(e).__name__)
            return JSONResponse({"status": "not_ready", "database": "unreachable"}, status_code=503)
    return JSONResponse({"status": "ready", "database": "ok" if connection else "memory"})


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness check. The only route that needs no backend token."""
    return {"status": "ok", "dev_login": dev_login_enabled()}
