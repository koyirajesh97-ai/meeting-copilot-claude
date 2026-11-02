from fastapi import FastAPI

app = FastAPI(title="Meeting Copilot backend", version="0.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check. The only route that needs no backend token."""
    return {"status": "ok"}
