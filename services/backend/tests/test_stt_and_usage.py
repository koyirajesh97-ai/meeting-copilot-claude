"""STT registry fallbacks, chunked STT, the Deepgram adapter protocol, /usage, Postgres quota."""

from __future__ import annotations

import asyncio
import json
import math
import struct
from datetime import date
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from websockets.asyncio.server import serve

from app.auth import issue_token
from app.main import app
from app.providers.stt.base import FakeSttAdapter, SttError, SttOptions
from app.providers.stt.chunked import ChunkedSession, Chunker
from app.providers.stt.deepgram import DeepgramAdapter
from app.router import DataPolicyError, InMemoryQuotaStore, QuotaTracker, RouterConfig
from app.router.quota import Cooldowns
from app.router.quota_pg import PostgresQuotaStore
from app.router.stt import SttRegistry
from app.services import build_services, set_services

ONE_SECOND_SILENCE = b"\x00\x00" * 16_000


def tone(seconds: float, amp: int = 8000) -> bytes:
    n = int(16_000 * seconds)
    return struct.pack(
        f"<{n}h", *(int(amp * math.sin(2 * math.pi * 300 * i / 16_000)) for i in range(n))
    )


def stt_config(**providers) -> RouterConfig:
    base = {
        "primary": {"kind": "stt_stream", "trains_on_data": False},
        "second": {"kind": "stt_stream", "trains_on_data": False},
        "risky": {"kind": "stt_stream", "trains_on_data": "unknown"},
        "last": {"kind": "stt_local", "trains_on_data": False},
    }
    base.update(providers)
    return RouterConfig.model_validate(
        {"tasks": {"stt_live": ["primary/m", "risky/m", "second/m", "last/m"]}, "providers": base}
    )


def registry(adapters: dict[str, FakeSttAdapter], cfg: RouterConfig | None = None) -> SttRegistry:
    cfg = cfg or stt_config()
    return SttRegistry(
        cfg,
        QuotaTracker(cfg, InMemoryQuotaStore()),
        Cooldowns(cfg),
        factory=lambda d, _c: adapters.get(d.id),
    )


async def test_stt_opens_first_available_provider_and_skips_risky_ones() -> None:
    adapters = {
        "primary/m": FakeSttAdapter("primary/m", is_available=False),
        "risky/m": FakeSttAdapter("risky/m"),
        "second/m": FakeSttAdapter("second/m"),
    }
    opened = await registry(adapters).open("meeting", SttOptions(keyterms=("Kubernetes",)))
    assert opened.deployment.id == "second/m"
    assert [s["outcome"] for s in opened.skipped] == [
        "not configured",
        "blocked: may train on meeting data",
    ]
    assert adapters["second/m"].opened[0].keyterms == ("Kubernetes",)


async def test_stt_open_failure_falls_back_and_excluded_providers_are_skipped() -> None:
    adapters = {
        "primary/m": FakeSttAdapter("primary/m", fail_on_open=True),
        "second/m": FakeSttAdapter("second/m"),
        "last/m": FakeSttAdapter("last/m"),
    }
    reg = registry(adapters)
    assert (await reg.open("meeting", SttOptions())).deployment.id == "second/m"
    again = await reg.open("meeting", SttOptions(), exclude={"second/m"})
    assert again.deployment.id == "last/m"


async def test_stt_policy_and_exhaustion_errors() -> None:
    cfg = RouterConfig.model_validate(
        {"tasks": {"stt_live": ["risky/m"]}, "providers": {"risky": {"kind": "stt_stream"}}}
    )
    with pytest.raises(DataPolicyError):
        await registry({"risky/m": FakeSttAdapter("risky/m")}, cfg).open("meeting", SttOptions())
    with pytest.raises(SttError, match="No live transcription"):
        await registry({}).open("meeting", SttOptions())


async def test_stt_audio_seconds_count_toward_quota() -> None:
    cfg = stt_config(
        primary={"kind": "stt_stream", "trains_on_data": False, "models": {"m": {"aspd": 100}}}
    )
    reg = registry({"primary/m": FakeSttAdapter("primary/m")}, cfg)
    opened = await reg.open("meeting", SttOptions())
    assert await reg.record_audio(opened.deployment, 50) is None
    assert await reg.record_audio(opened.deployment, 31) == pytest.approx(0.81)
    await reg.record_audio(opened.deployment, 15)
    with pytest.raises(SttError, match="'primary/m', 'outcome': 'daily quota at 95%'"):
        await reg.open("meeting", SttOptions())


async def test_fake_session_emits_partials_then_finals() -> None:
    session = await FakeSttAdapter(
        script=[("we ship on thursday", "0"), ("sounds good", "1")]
    ).open(SttOptions())
    for _ in range(4):
        await session.send(ONE_SECOND_SILENCE[:16_000])  # 0.5 s each
    await session.close()
    results = [r async for r in session.results()]
    assert [(r.text, r.is_final) for r in results] == [
        ("we ship", False),
        ("we ship on thursday", True),
        ("sounds", False),
        ("sounds good", True),
    ]
    assert results[1].speaker == "0" and (results[1].start_ms, results[1].end_ms) == (0, 1000)


def test_chunker_cuts_at_a_pause_after_5s_or_at_10s() -> None:
    c = Chunker()
    assert c.push(tone(4.0)) == []
    chunks = c.push(tone(2.0) + ONE_SECOND_SILENCE)
    assert len(chunks) == 1
    start, pcm = chunks[0]
    assert start == 0
    assert 6.2 <= len(pcm) / 32_000 <= 6.4  # cut 300 ms into the pause
    long = c.push(tone(12.0))
    assert len(long) == 1 and len(long[0][1]) == 10 * 32_000
    assert c.flush()[0][0] > 16_000  # offsets keep counting


async def test_chunked_session_skips_silence_and_reports_failures() -> None:
    seen: list[int] = []

    async def transcribe(pcm: bytes, _opts: SttOptions) -> str:
        seen.append(len(pcm))
        return "chunk text"

    s = ChunkedSession(transcribe, SttOptions())
    await s.send(ONE_SECOND_SILENCE * 11)  # pure silence: no request
    await s.send(tone(6.0) + ONE_SECOND_SILENCE)
    await s.close()
    results = [r async for r in s.results()]
    assert len(seen) == 1
    assert results[0].text == "chunk text" and results[0].is_final and results[0].start_ms == 10_000

    async def broken(_pcm: bytes, _opts: SttOptions) -> str:
        raise RuntimeError("HTTP 500")

    s2 = ChunkedSession(broken, SttOptions())
    await s2.send(tone(10.0))
    with pytest.raises(SttError, match="HTTP 500"):
        async for _ in s2.results():
            pass
    await s2.close()


async def test_deepgram_adapter_speaks_the_protocol(monkeypatch: pytest.MonkeyPatch) -> None:
    received: dict = {"bytes": 0, "control": []}

    async def fake_deepgram(ws) -> None:
        received["path"] = ws.request.path
        received["auth"] = ws.request.headers.get("Authorization")
        async for msg in ws:
            if isinstance(msg, bytes):
                received["bytes"] += len(msg)
                if received["bytes"] >= 32_000 and "sent" not in received:
                    received["sent"] = True
                    for is_final, text in [
                        (False, "the deploy"),
                        (True, "The deploy is Thursday."),
                    ]:
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "Results",
                                    "start": 1.5,
                                    "duration": 2.0,
                                    "is_final": is_final,
                                    "channel": {
                                        "alternatives": [
                                            {
                                                "transcript": text,
                                                "words": [
                                                    {"word": "the", "speaker": 1},
                                                    {"word": "deploy", "speaker": 1},
                                                ],
                                            }
                                        ]
                                    },
                                }
                            )
                        )
                    await ws.send(
                        json.dumps(
                            {"type": "Results", "channel": {"alternatives": [{"transcript": ""}]}}
                        )
                    )
            else:
                received["control"].append(json.loads(msg)["type"])
                if json.loads(msg)["type"] == "CloseStream":
                    await ws.close()
                    return

    async with serve(fake_deepgram, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-test")
        adapter = DeepgramAdapter(url=f"ws://127.0.0.1:{port}/v1/listen")
        assert adapter.available()
        session = await adapter.open(SttOptions(keyterms=("Kubernetes", "SRE"), diarize=True))
        await session.send(ONE_SECOND_SILENCE)
        results = []

        async def collect() -> None:
            async for r in session.results():
                results.append(r)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.2)
        await session.close()
        await asyncio.wait_for(task, 2)

    q = parse_qs(urlparse(received["path"]).query)
    assert q["mip_opt_out"] == ["true"]
    assert q["keyterm"] == ["Kubernetes", "SRE"]
    assert (
        q["diarize"] == ["true"] and q["encoding"] == ["linear16"] and q["sample_rate"] == ["16000"]
    )
    assert received["auth"] == "Token dg-test"
    assert received["control"] == ["CloseStream"]
    assert [(r.text, r.is_final, r.start_ms, r.end_ms, r.speaker) for r in results] == [
        ("the deploy", False, 1500, 3500, "1"),
        ("The deploy is Thursday.", True, 1500, 3500, "1"),
    ]


async def test_deepgram_drop_mid_stream_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def flaky(ws) -> None:
        await ws.recv()
        await ws.close(code=1011)

    async with serve(flaky, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        monkeypatch.setenv("DEEPGRAM_API_KEY", "k")
        session = await DeepgramAdapter(url=f"ws://127.0.0.1:{port}").open(SttOptions())
        await session.send(b"\x00" * 640)
        with pytest.raises(SttError):
            async for _ in session.results():
                pass


def test_usage_needs_a_token_and_reports_every_deployment() -> None:
    s = build_services(store=InMemoryQuotaStore())
    set_services(s)
    try:
        client = TestClient(app)
        assert client.get("/usage").status_code == 401
        assert client.get("/usage", headers={"Authorization": "Bearer junk"}).status_code == 401
        d = s.config.tasks["card"][0]
        asyncio.run(s.quota.record(d, "card", tokens=170_000))
        r = client.get("/usage", headers={"Authorization": f"Bearer {issue_token('u1')}"})
        assert r.status_code == 200
        rows = {f"{x['provider']}/{x['model']}": x for x in r.json()["deployments"]}
        assert "deepgram/nova-3" in rows and "mistral/mistral-small-latest" in rows
        row = rows["groq/openai/gpt-oss-20b"]
        assert (
            row["tokens"] == 170_000 and row["percent_used"] == 85.0 and row["status"] == "warning"
        )
        assert row["by_task"] == [
            {"task": "card", "requests": 1, "tokens": 170_000, "audio_seconds": 0.0}
        ]
        assert rows["gemini/gemini-flash"]["trains_on_data"] is True
        assert rows["mistral/mistral-small-latest"]["status"] == "unknown"
    finally:
        set_services(None)


def test_ws_tokens_cannot_call_the_api() -> None:
    client = TestClient(app)
    token = issue_token("u1", scope="ws", meeting_id="m1")
    assert client.get("/usage", headers={"Authorization": f"Bearer {token}"}).status_code == 401


async def test_postgres_quota_store_accumulates(pg_dsn: str) -> None:
    store = PostgresQuotaStore(pg_dsn)
    day = date(2026, 11, 2)
    await store.add("groq", "m", "card", day, 1, 100, 0)
    await store.add("groq", "m", "card", day, 1, 50, 0)
    await store.add("groq", "m", "detect", day, 2, 10, 0)
    await store.add("deepgram", "nova-3", "stt_live", day, 0, 0, 12.5)
    totals = await store.totals("groq", "m", day)
    assert (totals.requests, totals.tokens) == (4, 160)
    assert (await store.totals("deepgram", "nova-3", day)).audio_seconds == 12.5
    assert (await store.totals("groq", "m", date(2026, 11, 3))).requests == 0
    rows = await store.rows(day)
    assert [(r.provider, r.task, r.usage.tokens) for r in rows] == [
        ("deepgram", "stt_live", 0),
        ("groq", "card", 150),
        ("groq", "detect", 10),
    ]
