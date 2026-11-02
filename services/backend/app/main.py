import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import meetings, usage
from app.services import services
from app.ws import meetings as ws_meetings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    # Flush live meetings' transcripts on shutdown.
    await services().sessions.shutdown()


app = FastAPI(title="Meeting Copilot backend", version="0.0.0", lifespan=lifespan)
app.include_router(usage.router)
app.include_router(meetings.router)
app.include_router(ws_meetings.router)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check. The only route that needs no backend token."""
    return {"status": "ok"}
