import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import SIGN_IN, RateLimiter, client_address


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


def test_a_forged_forwarded_for_header_does_not_reset_the_limit(monkeypatch) -> None:
    """Behind one proxy, the address it appended (rightmost) is the key, not what the caller
    put on the left."""
    monkeypatch.setenv("COPILOT_PROXY_HOPS", "1")
    monkeypatch.setattr(SIGN_IN, "limit", 3)
    SIGN_IN.reset()
    with TestClient(app) as client:
        codes = [
            client.post(
                "/auth/session",
                json={"access_token": "junk"},
                headers={"X-Forwarded-For": f"10.9.8.{i}, 203.0.113.7"},
            ).status_code
            for i in range(4)
        ]
        other = client.post(
            "/auth/session",
            json={"access_token": "junk"},
            headers={"X-Forwarded-For": "203.0.113.8"},
        ).status_code
    SIGN_IN.reset()
    assert codes == [401, 401, 401, 429] and other == 401


class _Req:
    def __init__(self, xff: str | None, peer: str = "198.51.100.1") -> None:
        self.headers = {"x-forwarded-for": xff} if xff is not None else {}
        self.client = type("C", (), {"host": peer})()


def test_client_address_by_proxy_hops(monkeypatch) -> None:
    monkeypatch.delenv("COPILOT_PROXY_HOPS", raising=False)
    assert client_address(_Req("1.1.1.1")) == "198.51.100.1"  # no proxy: header ignored
    monkeypatch.setenv("COPILOT_PROXY_HOPS", "2")
    assert client_address(_Req("6.6.6.6, 203.0.113.7, 10.0.0.2")) == "203.0.113.7"
    assert client_address(_Req("203.0.113.7")) == "203.0.113.7"
    assert client_address(_Req(None)) == "198.51.100.1"
