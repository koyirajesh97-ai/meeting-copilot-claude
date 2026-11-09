import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import SIGN_IN, RateLimiter


def test_limit_window_and_retry_after() -> None:
    now = [0.0]
    rl = RateLimiter(2, 60, clock=lambda: now[0])
    rl.check("a")
    rl.check("a")
    rl.check("b")  # separate key
    with pytest.raises(HTTPException) as e:
        rl.check("a")
    assert e.value.status_code == 429 and int(e.value.headers["Retry-After"]) >= 1
    now[0] = 61.0  # the window moved on
    rl.check("a")


def test_sign_in_attempts_are_limited_per_address(monkeypatch) -> None:
    monkeypatch.setattr(SIGN_IN, "limit", 3)
    with TestClient(app) as client:
        codes = [
            client.post("/auth/session", json={"access_token": "junk"}).status_code
            for _ in range(4)
        ]
    assert codes == [401, 401, 401, 429]
