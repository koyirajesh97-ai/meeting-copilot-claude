"""Provider router: fallback order, cooldowns, quotas, data policy, JSON validation."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from pydantic import BaseModel

from app.router import (
    DataPolicyError,
    FakeClient,
    InMemoryQuotaStore,
    NoProviderAvailable,
    ProviderError,
    ProviderSwitched,
    QuotaTracker,
    QuotaWarning,
    Router,
    RouterConfig,
    load_config,
)
from app.router.quota import Cooldowns, MinuteLimiter, quota_day
from app.router.router import parse_json_output


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_config(**overrides) -> RouterConfig:
    raw = {
        "tasks": {
            "card": ["fast/a", "slow/b", "safe/c"],
            "summary": ["trains/x", "unknown/y", "safe/c"],
            "risky": ["trains/x", "unknown/y"],
        },
        "timeouts_s": {"card": 0.05, "summary": 1},
        "providers": {
            "fast": {
                "base_url": "http://fast",
                "trains_on_data": False,
                "models": {"a": {"rpd": 10, "rpm": 100}},
            },
            "slow": {"base_url": "http://slow", "trains_on_data": False},
            "safe": {"base_url": "http://safe", "trains_on_data": False},
            "trains": {"base_url": "http://t", "trains_on_data": True},
            "unknown": {"base_url": "http://u", "trains_on_data": "unknown"},
        },
    }
    raw.update(overrides)
    return RouterConfig.model_validate(raw)


def make_router(script=None, cfg=None, clock=None):
    cfg = cfg or make_config()
    clock = clock or Clock()
    client = FakeClient(script or {})
    tracker = QuotaTracker(cfg, InMemoryQuotaStore())
    router = Router(
        cfg, client, tracker, cooldowns=Cooldowns(cfg, clock), limiter=MinuteLimiter(clock)
    )
    notices: list = []
    router.subscribe(notices.append)
    return router, client, notices, clock


MSG = [{"role": "user", "content": "hi"}]


async def test_first_provider_serves_when_healthy() -> None:
    router, client, notices, _ = make_router({"fast/a": ["hello"]})
    out = await router.complete("card", MSG, "meeting")
    assert (out.text, out.provider) == ("hello", "fast/a")
    assert client.calls == ["fast/a"]
    assert notices == []
    assert out.latency_ms >= 0


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        (ProviderError("rate limited", status=429), "429 rate limited"),
        (ProviderError("boom", status=503), "error 503"),
        ("timeout", "timeout after 0.05s"),
    ],
)
async def test_falls_back_in_order_and_reports_why(failure, reason) -> None:
    router, client, notices, _ = make_router({"fast/a": [failure], "slow/b": ["from b"]})
    out = await router.complete("card", MSG, "meeting")
    assert out.provider == "slow/b"
    assert client.calls == ["fast/a", "slow/b"]
    assert len(notices) == 1
    n = notices[0]
    assert isinstance(n, ProviderSwitched)
    assert (n.task, n.from_, n.to) == ("card", "fast/a", "slow/b")
    assert n.reason.startswith(reason)


async def test_per_call_listener_gets_notices_too() -> None:
    router, _, _, _ = make_router({"fast/a": [ProviderError("x", status=429)]})
    mine: list = []
    await router.complete("card", MSG, "meeting", on_notice=mine.append)
    assert [type(n).__name__ for n in mine] == ["ProviderSwitched"]


class Card(BaseModel):
    bullets: list[str]
    confidence: float


async def test_invalid_json_retries_once_on_same_provider() -> None:
    router, client, _, _ = make_router(
        {"fast/a": ["not json", '{"bullets": ["x"], "confidence": 0.9}']}
    )
    out = await router.complete("card", MSG, "meeting", Card)
    assert client.calls == ["fast/a", "fast/a"]
    assert out.json == Card(bullets=["x"], confidence=0.9)


async def test_invalid_json_twice_falls_back() -> None:
    router, client, notices, _ = make_router(
        {
            "fast/a": ['{"bullets": "wrong type"}'],
            "slow/b": ['```json\n{"bullets": [], "confidence": 0}\n```'],
        }
    )
    out = await router.complete("card", MSG, "meeting", Card)
    assert client.calls == ["fast/a", "fast/a", "slow/b"]
    assert out.json.confidence == 0
    assert "invalid JSON" in notices[0].reason


async def test_rate_limited_provider_cools_down_then_returns() -> None:
    router, client, _, clock = make_router(
        {"fast/a": [ProviderError("x", status=429, retry_after=10), "ok"]}
    )
    await router.complete("card", MSG, "meeting")
    client.calls.clear()
    out = await router.complete("card", MSG, "meeting")
    assert out.provider == "slow/b"
    assert client.calls == ["slow/b"]  # fast/a skipped while cooling down
    clock.t += 11
    out = await router.complete("card", MSG, "meeting")
    assert out.provider == "fast/a"


async def test_repeated_failures_trigger_cooldown() -> None:
    router, client, _, clock = make_router({"fast/a": [ProviderError("e", status=500)]})
    for _ in range(3):
        await router.complete("card", MSG, "meeting")
    client.calls.clear()
    await router.complete("card", MSG, "meeting")
    assert client.calls == ["slow/b"]
    clock.t += 31
    client.calls.clear()
    await router.complete("card", MSG, "meeting")
    assert client.calls[0] == "fast/a"


async def test_quota_warns_once_at_80_and_skips_at_95() -> None:
    router, client, notices, _ = make_router()
    for _ in range(7):
        await router.complete("card", MSG, "meeting")
    assert not [n for n in notices if isinstance(n, QuotaWarning)]
    await router.complete("card", MSG, "meeting")  # 8/10 = 80%
    warnings = [n for n in notices if isinstance(n, QuotaWarning)]
    assert warnings == [QuotaWarning(provider="fast", task="card", percent_used=80.0)]
    await router.complete("card", MSG, "meeting")  # 90%: no second warning
    assert len([n for n in notices if isinstance(n, QuotaWarning)]) == 1
    await router.complete("card", MSG, "meeting")  # 100%
    client.calls.clear()
    out = await router.complete("card", MSG, "meeting")
    assert out.provider == "slow/b"
    assert out.attempts[0] == {"deployment": "fast/a", "outcome": "daily quota at 95%"}


async def test_per_minute_limit_moves_to_next_provider() -> None:
    cfg = make_config()
    cfg.providers["fast"].models["a"].rpm = 2
    router, client, _, clock = make_router(cfg=cfg)
    for _ in range(2):
        await router.complete("card", MSG, "meeting")
    out = await router.complete("card", MSG, "meeting")
    assert out.provider == "slow/b"
    clock.t += 61
    assert (await router.complete("card", MSG, "meeting")).provider == "fast/a"


async def test_meeting_data_never_reaches_training_or_unknown_providers() -> None:
    router, client, _, _ = make_router()
    out = await router.complete("summary", MSG, "meeting")
    assert out.provider == "safe/c"
    assert client.calls == ["safe/c"]
    assert [a["outcome"] for a in out.attempts[:2]] == ["blocked: may train on meeting data"] * 2


async def test_test_data_may_use_any_provider() -> None:
    router, client, _, _ = make_router()
    out = await router.complete("summary", MSG, "test")
    assert out.provider == "trains/x"


async def test_explicit_opt_in_allows_test_only_providers() -> None:
    router, _, _, _ = make_router()
    out = await router.complete("risky", MSG, "meeting", allow_test_only=True)
    assert out.provider == "trains/x"


async def test_clear_error_when_no_allowed_provider_is_left() -> None:
    router, client, _, _ = make_router()
    with pytest.raises(DataPolicyError, match="meeting data can't be sent"):
        await router.complete("risky", MSG, "meeting")
    assert client.calls == []


async def test_all_failing_raises_with_every_attempt() -> None:
    err = ProviderError("down", status=500)
    router, _, _, _ = make_router({"fast/a": [err], "slow/b": [err], "safe/c": [err]})
    with pytest.raises(NoProviderAvailable) as e:
        await router.complete("card", MSG, "meeting")
    assert [a["deployment"] for a in e.value.attempts] == ["fast/a", "slow/b", "safe/c"]


async def test_unknown_task_is_a_config_error() -> None:
    router, _, _, _ = make_router()
    with pytest.raises(KeyError, match="providers.yaml"):
        await router.complete("nope", MSG, "test")


def test_quota_day_respects_provider_reset_hour() -> None:
    t = datetime(2026, 11, 2, 3, 30, tzinfo=UTC)
    assert quota_day(t, 0) == date(2026, 11, 2)
    assert quota_day(t, 8) == date(2026, 11, 1)


def test_json_parsing_tolerates_fences_only() -> None:
    assert parse_json_output('```json\n{"a": 1}\n```', None) == {"a": 1}
    assert parse_json_output(' {"a": 1} ', None) == {"a": 1}


def test_real_config_has_a_meeting_safe_provider_for_every_task() -> None:
    cfg = load_config()
    for task, chain in cfg.tasks.items():
        safe = [d for d in chain if cfg.provider(d.provider).trains_on_data is False]
        assert safe, f"{task} has no provider allowed to receive meeting data"
    assert cfg.timeout("card") == 1.5
    assert cfg.tasks["card"][0].id == "groq/openai/gpt-oss-20b"
    assert cfg.limits(cfg.tasks["detect"][0]).rpd == 14400
