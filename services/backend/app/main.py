import logging

from fastapi import FastAPI

from app.api import usage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="Meeting Copilot backend", version="0.0.0")
app.include_router(usage.router)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check. The only route that needs no backend token."""
    return {"status": "ok"}
