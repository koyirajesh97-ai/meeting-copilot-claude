"""Small in-process rate limits: sign-in attempts per address, and AI-heavy actions per user
(they spend the shared free provider quotas). One backend process; a fleet would need a shared
store (Redis) instead."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self, limit: int, window_s: float, clock=time.monotonic) -> None:
        self.limit = limit
        self.window_s = window_s
        self.clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = self.clock()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window_s:
            hits.popleft()
        if len(hits) >= self.limit:
            retry = max(1, int(self.window_s - (now - hits[0])) + 1)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many requests, try again shortly.",
                headers={"Retry-After": str(retry)},
            )
        hits.append(now)
        if len(self._hits) > 50_000:  # forget idle keys
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window_s][
                :10_000
            ]:
                self._hits.pop(k, None)

    def reset(self) -> None:
        self._hits.clear()


#: Sign-in: 20 tries a minute per address.
SIGN_IN = RateLimiter(20, 60)
#: Ask, standup drafts, summary regeneration: 30 a minute per user.
AI_ACTIONS = RateLimiter(30, 60)


def proxy_hops() -> int:
    """How many proxies in front of this server append to X-Forwarded-For (COPILOT_PROXY_HOPS;
    the container image sets 1 for Railway's or Render's edge). 0: no proxy, use the socket."""
    try:
        return max(0, int(os.environ.get("COPILOT_PROXY_HOPS", "0")))
    except ValueError:
        return 0


def client_address(request: Request) -> str:
    """The caller's address for rate limits. Behind proxies it's the entry the nearest trusted
    proxy appended, counted from the right: the left end of X-Forwarded-For is whatever the
    caller sent, so keying on it would let anyone pick a fresh address per request."""
    hops = proxy_hops()
    forwarded = request.headers.get("x-forwarded-for", "")
    if hops and forwarded:
        entries = [e.strip() for e in forwarded.split(",") if e.strip()]
        if entries:
            return entries[-hops] if len(entries) >= hops else entries[0]
    # Note: uvicorn's --proxy-headers rewrites request.client from the *left* end, so it's only
    # used when no proxy is configured.
    return request.client.host if request.client else "unknown"
