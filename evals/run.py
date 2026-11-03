"""All evals in one run, compared against evals/baseline.json. CI runs it in Fake mode and fails
on a regression.

    cd services/backend
    uv run python ../../evals/run.py                   # Fake providers (what CI runs)
    uv run python ../../evals/run.py --update-baseline # after an intended change
    uv run python ../../evals/run.py --json out.json   # also write the report

What it measures:
- transcript: word error rate of the stored transcript against the script, per channel, through
  the real gateway, with the first transcription provider failing mid-meeting and the client
  reconnecting (catches lost or duplicated captions in our code; real-provider WER needs --real
  and your own recordings).
- me_vs_others: mic captions labeled "me", meeting-audio captions labeled as other speakers.
- named_speakers: enrolled voices named correctly, unenrolled voices left unnamed (synthetic voices).
- action_item_recall: evals/summaries on its fixtures.
- live_cards: evals/live (question detection, cards, citations).
- latency: p50 / p95 per stage and per provider (app.metrics), against the PRD budgets.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

# Fake providers, in-memory storage: no keys, no network, the same result on every machine.
os.environ["COPILOT_FAKE_PROVIDERS"] = "1"
os.environ.pop("DATABASE_URL", None)
os.environ.setdefault("BACKEND_SECRET", "evals-secret-evals-secret-evals-secret-0123")
os.environ["COPILOT_RETENTION_JOB"] = "0"

HERE = Path(__file__).parent
BACKEND = HERE.parent / "services" / "backend"
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import issue_token  # noqa: E402
from app.main import app  # noqa: E402
from app.meetings.store import InMemoryMeetingStore  # noqa: E402
from app.metrics import metrics  # noqa: E402
from app.providers.stt.base import BYTES_PER_SECOND, SttError, SttResult  # noqa: E402
from app.router import InMemoryQuotaStore, load_config  # noqa: E402
from app.services import build_services, set_services  # noqa: E402

BASELINE = HERE / "baseline.json"
#: Latency budgets (ms, p95) from the PRD; Fake mode must stay far below them.
BUDGETS_P95 = {"stt.final_ms": 1500, "card.total_ms": 4000, "llm.card": 4000, "llm.summary": 60_000}


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def h(user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(user)}"}


# ---------- word error rate ----------


def words(text: str) -> list[str]:
    return "".join(c.lower() if c.isalnum() or c == "'" else " " for c in text).split()


def wer(ref: str, hyp: str) -> float:
    r, hy = words(ref), words(hyp)
    if not r:
        return 0.0 if not hy else 1.0
    prev = list(range(len(hy) + 1))
    for i, rw in enumerate(r, 1):
        cur = [i] + [0] * len(hy)
        for j, hw in enumerate(hy, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rw != hw))
        prev = cur
    return prev[-1] / len(r)


# ---------- a scripted transcriber on the meeting's clock ----------

MIC = [
    "Morning everyone, quick update from me.",
    "I finished the certificate renewal for the payments cluster yesterday.",
    "Today I'm moving the production deploy to Thursday.",
    "I'm blocked on VPN access for the staging environment.",
    "That's all from me, back to you Priya.",
]
SYSTEM = [
    ("Thanks Sai, Priya here with the retry work.", "0"),
    ("The retry pull request is ready for review this afternoon.", "0"),
    ("Alex, can you add metrics for the retry queue by Friday?", "0"),
    ("Sure, I'll add the retry metrics and a dashboard by Friday.", "1"),
    ("One risk: the payment gateway rate limits during peak hours.", "1"),
]
SECONDS_PER_LINE = 2.0


@dataclass
class ClockSession:
    """Lines are placed on the channel's audio clock, shared by every session of the adapter, so a
    replacement provider continues where the failed one stopped (as a real one would)."""

    adapter: ScriptedTranscriber
    channel: str
    fail_after_s: float | None
    _queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    _sent: int = 0
    _closed: bool = False

    async def send(self, pcm: bytes) -> None:
        if self._closed:
            return
        self._sent += len(pcm)
        clock = self.adapter.clock
        clock[self.channel] = clock.get(self.channel, 0) + len(pcm)
        at = clock[self.channel] / BYTES_PER_SECOND
        if self.fail_after_s is not None and self._sent / BYTES_PER_SECOND >= self.fail_after_s:
            self._closed = True
            await self._queue.put(SttError("scripted provider failure"))
            return
        script = self.adapter.scripts[self.channel]
        done = self.adapter.done.setdefault(self.channel, 0)
        while done < len(script) and at >= (done + 1) * SECONDS_PER_LINE:
            text, speaker = script[done]
            start = int(done * SECONDS_PER_LINE * 1000)
            await self._queue.put(
                SttResult(text, True, start, start + int(SECONDS_PER_LINE * 1000), speaker)
            )
            done += 1
        self.adapter.done[self.channel] = done

    async def _iter(self):
        while True:
            item = await self._queue.get()
            if item is None:
                return
            if isinstance(item, Exception):
                raise item
            yield item

    def results(self):
        return self._iter()

    async def close(self) -> None:
        if not self._closed:
            self._closed = True
            await self._queue.put(None)


class ScriptedTranscriber:
    def __init__(self, name: str, shared: dict, fail_after_s: float | None = None) -> None:
        self.name = name
        self.scripts = {"mic": [(t, None) for t in MIC], "system": SYSTEM}
        self.clock: dict[str, int] = shared.setdefault("clock", {})
        self.done: dict[str, int] = shared.setdefault("done", {})
        self.fail_after_s = fail_after_s

    def available(self) -> bool:
        return True

    async def open(self, opts) -> ClockSession:
        channel = "system" if opts.diarize else "mic"
        # Only the system channel's first provider fails, once.
        fail = self.fail_after_s if channel == "system" else None
        self.fail_after_s = None if channel == "system" else self.fail_after_s
        return ClockSession(self, channel, fail)


def transcript_eval() -> dict:
    shared: dict = {}
    first = load_config().tasks["stt_live"][0].id

    def factory(d, _cfg):
        key = f"adapter:{d.id}"
        if key not in shared:
            shared[key] = ScriptedTranscriber(
                d.id, shared, fail_after_s=4.5 if d.id == first else None
            )
        return shared[key]

    store = InMemoryMeetingStore()
    s = build_services(
        config=load_config(), store=InMemoryQuotaStore(), meetings=store, stt_factory=factory
    )
    set_services(s)
    n = len(MIC)
    total_frames = int(n * SECONDS_PER_LINE * 50) + 25
    events: list[dict] = []
    try:
        with TestClient(app) as client:
            m = client.post(
                "/meetings", json={"type": "standup", "title": "Eval standup"}, headers=h("eval")
            ).json()
            mid = m["meeting_id"]
            silence = b"\x00" * 640

            frame = b"\x00" + silence + b"\x01" + silence  # mic + system, 20 ms each
            half = total_frames // 2
            # Half the meeting, then the connection drops before we read anything.
            with client.websocket_connect(f"/ws/meetings/{mid}?token={m['ws_token']}") as ws:
                for _ in range(half):
                    ws.send_bytes(frame)
                ws.send_text('{"type": "ping"}')
            # Reconnect with last_seq=0: the server replays everything we missed, then the rest.
            token = client.post(f"/meetings/{mid}/ws-token", headers=h("eval")).json()["ws_token"]
            with client.websocket_connect(f"/ws/meetings/{mid}?token={token}&last_seq=0") as ws:
                for _ in range(total_frames - half):
                    ws.send_bytes(frame)
                seen: set[str] = set()
                while len(seen) < 2 * n:
                    e = ws.receive_json()
                    events.append(e)
                    if e["type"] == "transcript.final":
                        seen.add(e["segment_id"])
                ws.send_text('{"type": "ping"}')
            client.post(f"/meetings/{mid}/end", headers=h("eval"))
            segs = client.portal.call(store.segments, mid)
    finally:
        set_services(None)

    def joined(channel: str) -> str:
        return " ".join(
            x.text
            for x in sorted((x for x in segs if x.channel == channel), key=lambda x: x.start_ms)
        )

    w_mic, w_sys = (
        wer(" ".join(MIC), joined("mic")),
        wer(" ".join(t for t, _ in SYSTEM), joined("system")),
    )
    finals = {e["segment_id"]: e for e in events if e["type"] == "transcript.final"}
    me_ok = sum((e["speaker_id"] == "me") == (e["channel"] == "mic") for e in finals.values())
    return {
        "wer": round((w_mic + w_sys) / 2, 4),
        "wer_mic": round(w_mic, 4),
        "wer_system": round(w_sys, 4),
        "me_vs_others": round(me_ok / len(finals), 4) if finals else 0.0,
        "finals_received": len(finals),
        "provider_switched": any(e["type"] == "provider.switched" for e in events),
    }


# ---------- named speakers ----------


def speaker_eval() -> dict:
    voices = load("eval_voices", BACKEND / "tests" / "voices.py")
    import io
    import wave

    f0 = {"A": 110, "B": 190, "C": 290}

    def wav(pcm: bytes) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(pcm)
        return buf.getvalue()

    cfg = load_config()
    cfg.speaker_id.min_audio_s = 4
    from app.providers.stt.base import FakeSttAdapter

    rounds = 3
    script = [
        (f"line by {who}", label)
        for _ in range(rounds)
        for who, label in [("A", "0"), ("B", "1"), ("C", "2")]
    ]
    store = InMemoryMeetingStore()
    s = build_services(
        config=cfg,
        store=InMemoryQuotaStore(),
        meetings=store,
        stt_factory=lambda d, _c: FakeSttAdapter(d.id, script, seconds_per_line=3.0),
    )
    set_services(s)
    expected = {"spk_0": "Sai", "spk_1": "Priya", "spk_2": None}
    try:
        with TestClient(app) as client:

            def enroll(user: str, v: str, name: str, project_id: str | None = None) -> None:
                data = {"consent": "true", "display_name": name} | (
                    {"project_id": project_id} if project_id else {}
                )
                r = client.post(
                    "/speakers/enroll",
                    headers=h(user),
                    data=data,
                    files={"audio": ("v.wav", wav(voices.voice(f0[v], 12, 7)), "audio/wav")},
                )
                assert r.status_code == 201, r.text

            enroll("u1", "A", "Sai")
            pid = client.post("/projects", json={"name": "Payments"}, headers=h("u1")).json()["id"]
            client.portal.call(s.projects.set_member, pid, "u2", "member")
            enroll("u2", "B", "Priya", pid)
            m = client.post(
                "/meetings",
                json={"type": "review", "title": "voices", "project_id": pid},
                headers=h("u1"),
            ).json()
            pcm = b"".join(voices.voice(f0[v], 3, 10 + i) for i in range(rounds) for v in "ABC")
            with client.websocket_connect(
                f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}"
            ) as ws:
                ws.receive_json()
                for i in range(0, len(pcm) - 639, 640):
                    ws.send_bytes(b"\x01" + pcm[i : i + 640])
                finals = 0
                while finals < len(script):
                    finals += ws.receive_json()["type"] == "transcript.final"
                ws.send_text('{"type": "ping"}')
            client.post(f"/meetings/{m['meeting_id']}/end", headers=h("u1"))
            names = client.portal.call(store.speaker_names, m["meeting_id"])
    finally:
        set_services(None)
    correct = sum(names.get(label) == want for label, want in expected.items())
    return {"named_speakers": round(correct / len(expected), 4), "names": names}


# ---------- the rest ----------


def summary_eval() -> dict:
    summaries = load("eval_summaries", HERE / "summaries" / "run.py")
    from app.router.client import FakeClient
    from app.router.fake_responses import fake_responder

    services = build_services(client=FakeClient(responder=fake_responder))
    r = asyncio.run(summaries.run(services.router))
    return {"action_item_recall": r["recall"]}


def live_eval() -> dict:
    live = load("eval_live", HERE / "live" / "run.py")
    r = live.run(live.make_services())
    return {
        "live_cards": round(r["passed"] / r["total"], 4),
        "card_latency_median_ms": r["latency_ms"]["median"],
    }


def latency() -> dict:
    snap = metrics.snapshot()
    return {
        stage: {
            "p50": v["p50"],
            "p95": v["p95"],
            "count": v["count"],
            "providers": {p: {"p50": x["p50"], "p95": x["p95"]} for p, x in v["providers"].items()},
        }
        for stage, v in sorted(snap.items())
    }


# Higher is better for these; WER lower is better. Tolerances absorb harmless noise.
HIGHER = {"me_vs_others": 0.0, "named_speakers": 0.0, "action_item_recall": 0.0, "live_cards": 0.0}
LOWER = {"wer": 0.005}
FLOORS = {"me_vs_others": 0.95, "named_speakers": 0.85, "action_item_recall": 0.9}
CEILINGS = {"wer": 0.12}


def regressions(report: dict, baseline: dict) -> list[str]:
    out = []
    for k, tol in HIGHER.items():
        if k in baseline and report[k] < baseline[k] - tol:
            out.append(f"{k} fell from {baseline[k]} to {report[k]}")
    for k, tol in LOWER.items():
        if k in baseline and report[k] > baseline[k] + tol:
            out.append(f"{k} rose from {baseline[k]} to {report[k]}")
    out += [f"{k} {report[k]} is below the target {v}" for k, v in FLOORS.items() if report[k] < v]
    out += [
        f"{k} {report[k]} is above the target {v}" for k, v in CEILINGS.items() if report[k] > v
    ]
    for stage, budget in BUDGETS_P95.items():
        p95 = report["latency"].get(stage, {}).get("p95")
        if p95 is not None and p95 > budget:
            out.append(f"{stage} p95 {p95} ms is over the {budget} ms budget")
    if not report.get("provider_switched"):
        out.append("the transcript eval didn't exercise a provider switch")
    return out


def _watchdog(seconds: int) -> None:
    """The test socket client has no receive timeout; fail loudly instead of hanging CI."""
    import signal

    def boom(*_):
        raise TimeoutError(f"evals didn't finish in {seconds} s (an expected event never arrived)")

    signal.signal(signal.SIGALRM, boom)
    signal.alarm(seconds)


def main() -> int:
    _watchdog(300)
    ap = argparse.ArgumentParser()
    ap.add_argument("--update-baseline", action="store_true")
    ap.add_argument("--json", type=Path)
    args = ap.parse_args()
    metrics.reset()
    t0 = time.perf_counter()
    report: dict = {}
    report |= transcript_eval()
    report |= speaker_eval()
    report |= summary_eval()
    report |= live_eval()
    report["latency"] = latency()
    report["seconds"] = round(time.perf_counter() - t0, 1)
    if args.json:
        args.json.write_text(json.dumps(report, indent=2))
    keys = [*HIGHER, *LOWER]
    if args.update_baseline:
        BASELINE.write_text(json.dumps({k: report[k] for k in keys}, indent=2) + "\n")
        print(f"Baseline updated: {BASELINE}")
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else {}
    problems = regressions(report, baseline)
    print(
        json.dumps(
            {
                k: report[k]
                for k in [
                    *keys,
                    "wer_mic",
                    "wer_system",
                    "provider_switched",
                    "card_latency_median_ms",
                    "seconds",
                ]
            },
            indent=2,
        )
    )
    for stage, v in report["latency"].items():
        print(f"  {stage:28s} p50 {v['p50']:>8} ms  p95 {v['p95']:>8} ms  ({v['count']})")
    if problems:
        print("\nREGRESSIONS:\n- " + "\n- ".join(problems))
        return 1
    print("\nEvals: no regressions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
