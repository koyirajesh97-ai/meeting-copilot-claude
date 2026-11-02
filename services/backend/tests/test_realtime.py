"""Realtime gateway: meetings API, the meeting WebSocket, live STT, fallback, replay."""

from __future__ import annotations

import json
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.auth import issue_token
from app.main import app
from app.meetings.store import InMemoryMeetingStore
from app.metrics import metrics
from app.providers.stt.base import FakeSttAdapter
from app.realtime.timeline import Timeline
from app.router import InMemoryQuotaStore, load_config
from app.services import build_services, set_services

FIXTURE = Path(__file__).resolve().parents[3] / "evals" / "fixtures" / "audio" / "speech-16k.wav"
FRAME = 640


def wav_frames(channel: int) -> list[bytes]:
    with wave.open(str(FIXTURE)) as w:
        assert w.getframerate() == 16_000 and w.getnchannels() == 1
        pcm = w.readframes(w.getnframes())
    pcm += b"\x00" * (-len(pcm) % FRAME)
    return [bytes([channel]) + pcm[i : i + FRAME] for i in range(0, len(pcm), FRAME)]


SCRIPT = [
    ("so when is the prod deploy", "1"),
    ("thursday after the cert renewal", "0"),
    ("great thanks", "1"),
]


class Env:
    def __init__(self, adapters: dict[str, FakeSttAdapter]) -> None:
        self.adapters = adapters
        self.store = InMemoryMeetingStore()
        self.services = build_services(
            config=load_config(),
            store=InMemoryQuotaStore(),
            meetings=self.store,
            stt_factory=lambda d, _cfg: adapters.get(d.id),
        )
        set_services(self.services)
        self.client = TestClient(app)
        self.client.__enter__()  # one event loop for the whole test
        self.headers = {"Authorization": f"Bearer {issue_token('user-1', email='sai@example.com')}"}

    def create(self, **body) -> dict:
        r = self.client.post(
            "/meetings", json={"type": "standup", "title": "Daily", **body}, headers=self.headers
        )
        assert r.status_code == 201, r.text
        return r.json()

    def connect(self, m: dict, last_seq: int = 0):
        return self.client.websocket_connect(
            f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}&last_seq={last_seq}"
        )


@pytest.fixture
def env():
    adapters = {
        "deepgram/nova-3": FakeSttAdapter("deepgram/nova-3", SCRIPT, seconds_per_line=2.0),
        "groq/whisper-large-v3": FakeSttAdapter(
            "groq/whisper-large-v3", [("backup provider text", None)] * 5, seconds_per_line=1.0
        ),
        "local/faster-whisper": FakeSttAdapter("local/faster-whisper", [("local text", None)] * 5),
    }
    e = Env(adapters)
    metrics.reset()
    yield e
    e.client.__exit__(None, None, None)
    set_services(None)


def receive_until(ws, pred, limit: int = 500) -> list[dict]:
    got = []
    for _ in range(limit):
        ev = ws.receive_json()
        got.append(ev)
        if pred(ev):
            return got
    raise AssertionError(f"condition not met; got {[e['type'] for e in got]}")


def finals(events: list[dict]) -> list[dict]:
    return [e for e in events if e["type"] == "transcript.final"]


def test_create_meeting_requires_auth_and_returns_socket_details(env: Env) -> None:
    assert env.client.post("/meetings", json={}).status_code == 401
    m = env.create(vocabulary=["Kubernetes", " ArgoCD ", ""])
    assert m["ws_url"] == f"ws://testserver/ws/meetings/{m['meeting_id']}"
    stored = env.client.get(f"/meetings/{m['meeting_id']}", headers=env.headers).json()
    assert stored["type"] == "standup" and stored["mode"] == "cloud" and stored["ended_at"] is None
    other = {"Authorization": f"Bearer {issue_token('someone-else')}"}
    assert env.client.get(f"/meetings/{m['meeting_id']}", headers=other).status_code == 404


@pytest.mark.parametrize(
    ("token_for", "code"),
    [("junk", 4401), ("other-meeting", 4401), ("other-user", 4404), ("api-scope", 4401)],
)
def test_socket_rejects_bad_tokens(env: Env, token_for: str, code: int) -> None:
    m = env.create()
    token = {
        "junk": "junk",
        "other-meeting": issue_token("user-1", scope="ws", meeting_id="nope"),
        "other-user": issue_token("intruder", scope="ws", meeting_id=m["meeting_id"]),
        "api-scope": issue_token("user-1"),
    }[token_for]
    with env.client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={token}") as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
    assert e.value.code == code


def test_streams_a_wav_into_live_captions_and_stores_finals(env: Env) -> None:
    m = env.create(vocabulary=["ArgoCD"])
    with env.connect(m) as ws:
        started = ws.receive_json()
        assert started["type"] == "meeting.started" and started["seq"] == 1
        assert started["providers"] == {
            "stt_live.mic": "deepgram/nova-3",
            "stt_live.system": "deepgram/nova-3",
        }
        for f in wav_frames(1):
            ws.send_bytes(f)
        events = receive_until(
            ws, lambda e: e["type"] == "transcript.final" and e["text"] == "great thanks"
        )

    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    assert all(e["meeting_id"] == m["meeting_id"] for e in events)
    partials = [e for e in events if e["type"] == "transcript.partial"]
    assert partials and all(e["channel"] == "system" for e in partials)
    fs = finals(events)
    assert [(e["text"], e["speaker_id"]) for e in fs] == [
        ("so when is the prod deploy", "spk_1"),
        ("thursday after the cert renewal", "spk_0"),
        ("great thanks", "spk_1"),
    ]
    assert [e["segment_id"] for e in fs] == ["seg_1", "seg_2", "seg_3"]
    assert fs[1]["start_ms"] == pytest.approx(2000, abs=150) and fs[1]["end_ms"] == pytest.approx(
        4000, abs=150
    )

    opts = env.adapters["deepgram/nova-3"].opened
    assert {o.diarize for o in opts} == {True, False}  # system diarized, mic not
    assert all(o.keyterms == ("ArgoCD",) for o in opts)

    env.client.post(f"/meetings/{m['meeting_id']}/end", headers=env.headers)
    import asyncio

    stored = asyncio.run(env.store.segments(m["meeting_id"]))
    assert [s.text for s in stored] == [e["text"] for e in fs]
    assert {s.provider for s in stored} == {"deepgram/nova-3"}


def test_mic_channel_is_always_me(env: Env) -> None:
    m = env.create()
    with env.connect(m) as ws:
        ws.receive_json()
        for f in wav_frames(0)[:110]:  # 2.2 s
            ws.send_bytes(f)
        events = receive_until(ws, lambda e: e["type"] == "transcript.final")
    final = finals(events)[0]
    assert (final["channel"], final["speaker_id"]) == ("mic", "me")


def test_provider_failure_mid_meeting_falls_back_without_dropping_the_socket(env: Env) -> None:
    env.adapters["deepgram/nova-3"].fail_after_s = 2.5
    m = env.create()
    with env.connect(m) as ws:
        ws.receive_json()
        for f in wav_frames(1):
            ws.send_bytes(f)
        events = receive_until(
            ws, lambda e: e["type"] == "transcript.final" and e["text"] == "backup provider text"
        )
    switched = [e for e in events if e["type"] == "provider.switched"]
    assert len(switched) == 1
    assert switched[0]["task"] == "stt_live"
    assert switched[0]["from"] == "deepgram/nova-3"
    # Gladia is skipped: its data policy is unknown, so meeting audio can't go there.
    assert switched[0]["to"] == "groq/whisper-large-v3"
    assert "fake provider dropped the connection" in switched[0]["reason"]
    texts = [e["text"] for e in finals(events)]
    assert texts[0] == "so when is the prod deploy" and texts[-1] == "backup provider text"
    # Times keep counting from the meeting start, not from the new provider's zero.
    assert finals(events)[-1]["start_ms"] >= 2000
    snap = env.client.get("/metrics", headers=env.headers).json()["stages"]
    assert snap["stt.switch_ms"]["count"] == 1
    assert "deepgram/nova-3" in snap["stt.final_ms"]["providers"]


def test_reconnect_replays_missed_events_but_not_partials(env: Env) -> None:
    m = env.create()
    with env.connect(m) as ws:
        ws.receive_json()
        for f in wav_frames(1)[:110]:
            ws.send_bytes(f)
        first = receive_until(ws, lambda e: e["type"] == "transcript.final")
    last_seen = first[0]["seq"]  # pretend we only saw meeting.started... then everything after it
    token = env.client.post(f"/meetings/{m['meeting_id']}/ws-token", headers=env.headers).json()[
        "ws_token"
    ]
    with env.client.websocket_connect(
        f"/ws/meetings/{m['meeting_id']}?token={token}&last_seq={last_seen}"
    ) as ws:
        replayed = ws.receive_json()
        assert replayed["type"] == "transcript.final" and replayed["seq"] > last_seen
        assert replayed["text"] == "so when is the prod deploy"
        ws.send_bytes(wav_frames(1)[110])  # the meeting is still live after a reconnect
        ws.send_text(json.dumps({"type": "ping"}))


def test_bad_input_gets_an_error_event_not_a_disconnect(env: Env) -> None:
    m = env.create()
    with env.connect(m) as ws:
        ws.receive_json()
        ws.send_bytes(b"\x00" * 100)
        assert ws.receive_json()["code"] == "bad_audio_frame"
        ws.send_bytes(bytes([7]) + b"\x00" * FRAME)
        assert "unknown audio channel" in ws.receive_json()["message"]
        ws.send_text("not json")
        assert ws.receive_json()["code"] == "bad_message"
        ws.send_text(json.dumps({"type": "control", "action": "catch_up", "minutes": 2}))
        e = ws.receive_json()
        assert (e["type"], e["code"], e["retryable"]) == ("error", "not_implemented", False)


def test_pause_drops_audio_until_resume(env: Env) -> None:
    m = env.create()
    with env.connect(m) as ws:
        ws.receive_json()
        ws.send_text(json.dumps({"type": "control", "action": "pause"}))
        for f in wav_frames(1)[:150]:
            ws.send_bytes(f)
        ws.send_text(json.dumps({"type": "control", "action": "resume"}))
        for f in wav_frames(1)[:110]:
            ws.send_bytes(f)
        events = receive_until(ws, lambda e: e["type"] == "transcript.final")
        # Only the 2.2 s sent after resume reached the transcriber.
        worker = env.services.sessions.get(m["meeting_id"]).workers["system"]
        assert worker.timeline.audio_ms == pytest.approx(2200)
    assert finals(events)[0]["text"] == "so when is the prod deploy"


def test_ended_meeting_refuses_new_sockets(env: Env) -> None:
    m = env.create()
    assert (
        env.client.post(f"/meetings/{m['meeting_id']}/end", headers=env.headers).status_code == 204
    )
    with env.connect(m) as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
    assert e.value.code == 4409
    assert (
        env.client.post(f"/meetings/{m['meeting_id']}/ws-token", headers=env.headers).status_code
        == 409
    )


def test_local_mode_uses_only_local_transcription(env: Env) -> None:
    m = env.create(mode="local")
    with env.connect(m) as ws:
        started = ws.receive_json()
    assert set(started["providers"].values()) == {"local/faster-whisper"}
    assert env.adapters["deepgram/nova-3"].opened == []


def test_live_only_mode_saves_nothing(env: Env) -> None:
    m = env.create(mode="live-only")
    with env.connect(m) as ws:
        ws.receive_json()
        for f in wav_frames(1)[:110]:
            ws.send_bytes(f)
        assert finals(receive_until(ws, lambda e: e["type"] == "transcript.final"))
    import asyncio

    assert asyncio.run(env.store.segments(m["meeting_id"])) == []


def test_no_provider_reports_a_retryable_error(env: Env) -> None:
    for a in env.adapters.values():
        a.is_available = False
    m = env.create()
    with env.connect(m) as ws:
        errors = [ws.receive_json(), ws.receive_json()]
        started = ws.receive_json()
    assert {(e["type"], e["code"], e["retryable"]) for e in errors} == {
        ("error", "stt_unavailable", True)
    }
    assert {e["message"].split(":")[0] for e in errors} == {"mic", "system"}
    assert started["type"] == "meeting.started" and started["providers"] == {}


def test_timeline_places_gated_audio_at_wall_clock_time() -> None:
    tl = Timeline(meeting_start_wall_ms=0)
    tl.on_audio(32_000, wall_ms=1000)  # 1 s of speech arriving at t=1 s
    tl.on_audio(32_000, wall_ms=5000)  # VAD gap: next speech arrives at t=5 s
    assert tl.meeting_ms(500) == 1500
    assert tl.meeting_ms(1200) == 5200
    # A replayed backlog arriving faster than real time keeps the anchor.
    tl.on_audio(32_000, wall_ms=5100)
    assert tl.meeting_ms(2500) == 6500
