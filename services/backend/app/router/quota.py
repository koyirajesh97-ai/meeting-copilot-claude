"""Daily quota tracking per provider and model, plus per-minute rate windows and cooldowns.

Daily usage lives in a QuotaStore (Postgres `provider_usage` in production, memory in tests).
Per-minute windows and cooldowns are in-process only: they protect the next few seconds.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Protocol

from .config import Deployment, Limits, RouterConfig


@dataclass
class Usage:
    requests: int = 0
    tokens: int = 0
    audio_seconds: float = 0.0


@dataclass(frozen=True)
class UsageRow:
    provider: str
    model: str
    task: str
    day: date
    usage: Usage


class QuotaStore(Protocol):
    async def add(
        self,
        provider: str,
        model: str,
        task: str,
        day: date,
        requests: int,
        tokens: int,
        audio_seconds: float,
    ) -> None: ...

    async def totals(self, provider: str, model: str, day: date) -> Usage:
        """Usage across all tasks for one deployment on one quota day."""
        ...

    async def rows(self, day: date) -> list[UsageRow]: ...


class InMemoryQuotaStore:
    def __init__(self) -> None:
        self._data: dict[tuple[str, str, str, date], Usage] = defaultdict(Usage)

    async def add(
        self,
        provider: str,
        model: str,
        task: str,
        day: date,
        requests: int,
        tokens: int,
        audio_seconds: float,
    ) -> None:
        u = self._data[(provider, model, task, day)]
        u.requests += requests
        u.tokens += tokens
        u.audio_seconds += audio_seconds

    async def totals(self, provider: str, model: str, day: date) -> Usage:
        total = Usage()
        for (p, m, _t, d), u in self._data.items():
            if (p, m, d) == (provider, model, day):
                total.requests += u.requests
                total.tokens += u.tokens
                total.audio_seconds += u.audio_seconds
        return total

    async def rows(self, day: date) -> list[UsageRow]:
        return [UsageRow(p, m, t, d, u) for (p, m, t, d), u in self._data.items() if d == day]


def quota_day(now: datetime, reset_utc_hour: int) -> date:
    """The quota day `now` falls in, for a provider that resets at reset_utc_hour UTC."""
    return (now.astimezone(UTC) - timedelta(hours=reset_utc_hour)).date()


def percent_used(usage: Usage, limits: Limits) -> float | None:
    """Highest share of any daily limit used (0..1+), or None if no daily limit is known."""
    shares = []
    if limits.rpd:
        shares.append(usage.requests / limits.rpd)
    if limits.tpd:
        shares.append(usage.tokens / limits.tpd)
    if limits.aspd:
        shares.append(usage.audio_seconds / limits.aspd)
    return max(shares) if shares else None


@dataclass
class _Window:
    events: deque[tuple[float, int]] = field(default_factory=deque)  # (time, tokens)

    def trim(self, now: float) -> None:
        while self.events and now - self.events[0][0] >= 60:
            self.events.popleft()

    def counts(self, now: float) -> tuple[int, int]:
        self.trim(now)
        return len(self.events), sum(t for _, t in self.events)


class MinuteLimiter:
    """Sliding 60 s window per deployment for rpm/tpm."""

    def __init__(self, clock=time.monotonic) -> None:
        self._w: dict[str, _Window] = defaultdict(_Window)
        self._clock = clock

    def has_room(self, d: Deployment, limits: Limits, est_tokens: int) -> bool:
        reqs, toks = self._w[d.id].counts(self._clock())
        if limits.rpm is not None and reqs + 1 > limits.rpm:
            return False
        return not (limits.tpm is not None and toks + est_tokens > limits.tpm)

    def record(self, d: Deployment, tokens: int) -> None:
        self._w[d.id].events.append((self._clock(), tokens))


class Cooldowns:
    """Rest a deployment after a 429, or after repeated failures."""

    def __init__(self, cfg: RouterConfig, clock=time.monotonic) -> None:
        self._cfg = cfg
        self._clock = clock
        self._failures: dict[str, int] = defaultdict(int)
        self._until: dict[str, float] = {}

    def cooling(self, d: Deployment) -> bool:
        return self._until.get(d.id, 0) > self._clock()

    def remaining(self, d: Deployment) -> float:
        return max(0.0, self._until.get(d.id, 0) - self._clock())

    def success(self, d: Deployment) -> None:
        self._failures[d.id] = 0

    def failure(
        self, d: Deployment, rate_limited: bool = False, retry_after: float | None = None
    ) -> None:
        if rate_limited:
            self._until[d.id] = self._clock() + (retry_after or self._cfg.rate_limit_cooldown_s)
            self._failures[d.id] = 0
            return
        self._failures[d.id] += 1
        if self._failures[d.id] >= self._cfg.failures_before_cooldown:
            self._until[d.id] = self._clock() + self._cfg.cooldown_s
            self._failures[d.id] = 0


class QuotaTracker:
    """Daily usage vs. limits: warn at 80%, skip at 95% (thresholds from config)."""

    def __init__(self, cfg: RouterConfig, store: QuotaStore, now=lambda: datetime.now(UTC)) -> None:
        self.cfg = cfg
        self.store = store
        self._now = now
        self._warned: set[tuple[str, date]] = set()

    def day_for(self, provider: str) -> date:
        return quota_day(self._now(), self.cfg.provider(provider).reset_utc_hour)

    async def percent(self, d: Deployment) -> float | None:
        usage = await self.store.totals(d.provider, d.model, self.day_for(d.provider))
        return percent_used(usage, self.cfg.limits(d))

    async def exhausted(self, d: Deployment) -> bool:
        p = await self.percent(d)
        return p is not None and p >= self.cfg.quota_skip_at

    async def record(
        self,
        d: Deployment,
        task: str,
        *,
        tokens: int = 0,
        audio_seconds: float = 0.0,
        requests: int = 1,
    ) -> float | None:
        """Record usage. Returns the percent used if this crossed the warning line for the first
        time today, so the caller can emit quota.warning."""
        day = self.day_for(d.provider)
        await self.store.add(d.provider, d.model, task, day, requests, tokens, audio_seconds)
        p = await self.percent(d)
        key = (d.id, day)
        if p is not None and p >= self.cfg.quota_warn_at and key not in self._warned:
            self._warned.add(key)
            return p
        return None
