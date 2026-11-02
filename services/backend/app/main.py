import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import auth, meetings, search, speakers, summaries, usage
from app.api.auth import dev_login_enabled
from app.services import services
from app.ws import meetings as ws_meetings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    # Flush live meetings' transcripts on shutdown.
    s = services()
    await s.sessions.shutdown()
    close = getattr(s.meetings, "close", None)
    if close:
        await close()


app = FastAPI(title="Meeting Copilot backend", version="0.0.0", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(usage.router)
app.include_router(meetings.router)
app.include_router(summaries.router)
app.include_router(search.router)
app.include_router(speakers.router)
app.include_router(ws_meetings.router)


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness check. The only route that needs no backend token."""
    return {"status": "ok", "dev_login": dev_login_enabled()}
