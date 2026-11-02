"""The provider router: every LLM call in the app goes through `Router.complete`.

For each task it walks the fallback chain from config/providers.yaml and skips deployments
that the data policy forbids, that are cooling down, that hit 95% of a daily quota, or that
have no room in their per-minute window. It falls back on 429, timeout, 5xx/other errors and
invalid JSON (after one retry on the same deployment), and reports fallbacks and quota
warnings to listeners so the meeting socket can send provider.switched / quota.warning.

LiteLLM is the client for every provider; the ordering, cooldowns and limits live here so the
data-policy guard and per-provider quota tracking can sit in the same loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from app.metrics import metrics

from .client import CompletionClient, ProviderError, ProviderResponse
from .config import Deployment, RouterConfig
from .policy import DataClass, DataPolicyError, allowed
from .quota import Cooldowns, MinuteLimiter, QuotaTracker

log = logging.getLogger("app.router")


@dataclass(frozen=True)
class ProviderSwitched:
    task: str
    from_: str
    to: str
    reason: str
    type: Literal["provider.switched"] = "provider.switched"


@dataclass(frozen=True)
class QuotaWarning:
    provider: str
    task: str
    percent_used: float
    type: Literal["quota.warning"] = "quota.warning"


RouterNotice = ProviderSwitched | QuotaWarning
Listener = Callable[[RouterNotice], Awaitable[None] | None]


@dataclass
class Completion:
    text: str
    provider: str  # deployment id, e.g. "groq/openai/gpt-oss-20b"
    latency_ms: int
    json: Any = None
    attempts: list[dict[str, str]] = field(default_factory=list)
    tokens: int = 0


class NoProviderAvailable(RuntimeError):
    def __init__(self, task: str, attempts: list[dict[str, str]]):
        detail = "; ".join(f"{a['deployment']}: {a['outcome']}" for a in attempts) or "empty chain"
        super().__init__(f"No provider could serve task {task!r} ({detail})")
        self.task = task
        self.attempts = attempts


class InvalidOutput(Exception):
    pass


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


def parse_json_output(text: str, schema: type[BaseModel] | None) -> Any:
    """Parse model output as JSON (tolerating ``` fences) and validate it against `schema`."""
    m = _FENCE.match(text)
    raw = m.group(1) if m else text.strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise InvalidOutput(f"not JSON: {e.msg}") from e
    if schema is None:
        return data
    try:
        return schema.model_validate(data)
    except ValidationError as e:
        raise InvalidOutput(f"schema mismatch: {e.error_count()} error(s)") from e


def _estimate_tokens(messages: list[dict[str, str]]) -> int:
    return sum(len(m.get("content", "")) for m in messages) // 4 + 256


class Router:
    def __init__(
        self,
        config: RouterConfig,
        client: CompletionClient,
        quota: QuotaTracker,
        *,
        cooldowns: Cooldowns | None = None,
        limiter: MinuteLimiter | None = None,
    ) -> None:
        self.config = config
        self.client = client
        self.quota = quota
        self.cooldowns = cooldowns or Cooldowns(config)
        self.limiter = limiter or MinuteLimiter()
        self._listeners: list[Listener] = []

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)

    async def _notify(self, notice: RouterNotice, extra: Listener | None) -> None:
        for fn in [*self._listeners, *([extra] if extra else [])]:
            try:
                r = fn(notice)
                if asyncio.iscoroutine(r):
                    await r
            except Exception:  # a listener must never break a call
                log.exception("router listener failed")

    async def complete(
        self,
        task: str,
        messages: list[dict[str, str]],
        data_class: DataClass,
        json_schema: type[BaseModel] | None = None,
        *,
        json_mode: bool | None = None,
        allow_test_only: bool = False,
        on_notice: Listener | None = None,
    ) -> Completion:
        chain = self.config.tasks.get(task)
        if chain is None:
            raise KeyError(f"Unknown task {task!r}; add it to config/providers.yaml")
        want_json = json_mode if json_mode is not None else json_schema is not None
        timeout = self.config.timeout(task)
        est = _estimate_tokens(messages)
        attempts: list[dict[str, str]] = []
        policy_blocked = 0
        last_tried: Deployment | None = None
        last_reason = ""
        started = time.perf_counter()

        for d in chain:
            provider = self.config.provider(d.provider)
            if not allowed(provider, data_class, allow_test_only):
                policy_blocked += 1
                attempts.append(
                    {"deployment": d.id, "outcome": "blocked: may train on meeting data"}
                )
                continue
            if self.cooldowns.cooling(d):
                attempts.append(
                    {
                        "deployment": d.id,
                        "outcome": f"cooling down {self.cooldowns.remaining(d):.0f}s",
                    }
                )
                continue
            if await self.quota.exhausted(d):
                attempts.append({"deployment": d.id, "outcome": "daily quota at 95%"})
                continue
            if not self.limiter.has_room(d, self.config.limits(d), est):
                attempts.append({"deployment": d.id, "outcome": "per-minute limit"})
                continue

            if last_tried is not None:
                await self._notify(
                    ProviderSwitched(task, last_tried.id, d.id, last_reason), on_notice
                )

            outcome, result = await self._try(
                d, task, messages, timeout, want_json, json_schema, on_notice
            )
            attempts.append({"deployment": d.id, "outcome": outcome})
            if result is not None:
                resp, parsed, call_ms = result
                latency = int((time.perf_counter() - started) * 1000)
                metrics.record(f"llm.{task}", latency, d.id)
                log.info(
                    "llm task=%s provider=%s call_ms=%d total_ms=%d tokens=%d attempts=%d",
                    task,
                    d.id,
                    call_ms,
                    latency,
                    resp.total_tokens,
                    len(attempts),
                )
                return Completion(
                    text=resp.text,
                    json=parsed,
                    provider=d.id,
                    latency_ms=latency,
                    attempts=attempts,
                    tokens=resp.total_tokens,
                )
            last_tried, last_reason = d, outcome

        if policy_blocked == len(chain):
            raise DataPolicyError(
                f"Every provider for {task!r} may train on its inputs, so meeting data can't be sent. "
                "Add a provider with trains_on_data: false to this task, or opt in under Settings."
            )
        log.warning("llm task=%s failed: %s", task, attempts)
        raise NoProviderAvailable(task, attempts)

    async def _try(
        self,
        d: Deployment,
        task: str,
        messages: list[dict[str, str]],
        timeout: float,
        want_json: bool,
        schema: type[BaseModel] | None,
        on_notice: Listener | None,
    ) -> tuple[str, tuple[ProviderResponse, Any, int] | None]:
        provider = self.config.provider(d.provider)
        # Invalid JSON gets one retry on the same deployment before falling back.
        for attempt in range(2 if want_json else 1):
            t0 = time.perf_counter()
            try:
                resp = await asyncio.wait_for(
                    self.client.complete(
                        d, provider, messages, timeout=timeout, json_mode=want_json
                    ),
                    timeout=timeout,
                )
            except TimeoutError:
                self.cooldowns.failure(d)
                return f"timeout after {timeout}s", None
            except ProviderError as e:
                self.cooldowns.failure(d, rate_limited=e.rate_limited, retry_after=e.retry_after)
                return (
                    "429 rate limited" if e.rate_limited else f"error {e.status or ''}: {e}".strip()
                ), None
            except Exception as e:  # unexpected client bug: still fall back
                self.cooldowns.failure(d)
                return f"error: {type(e).__name__}: {e}", None
            call_ms = int((time.perf_counter() - t0) * 1000)
            self.limiter.record(d, resp.total_tokens)
            warn = await self.quota.record(d, task, tokens=resp.total_tokens)
            if warn is not None:
                await self._notify(QuotaWarning(d.provider, task, round(warn * 100, 1)), on_notice)
            if not want_json:
                self.cooldowns.success(d)
                return "ok", (resp, None, call_ms)
            try:
                parsed = parse_json_output(resp.text, schema)
            except InvalidOutput as e:
                if attempt == 0:
                    continue
                self.cooldowns.failure(d)
                return f"invalid JSON twice ({e})", None
            self.cooldowns.success(d)
            return "ok", (resp, parsed, call_ms)
        return "unreachable", None
