import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

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


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness check. The only route that needs no backend token."""
    return {"status": "ok", "dev_login": dev_login_enabled()}
