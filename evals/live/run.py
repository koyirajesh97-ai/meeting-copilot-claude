"""Live-help eval: questions aimed at the user get cited cards fast; others get none.

    cd services/backend
    uv run python ../../evals/live/run.py            # Fake providers (CI)
    uv run python ../../evals/live/run.py --real     # free providers for detect/card (fixture data only)

Transcription is always the scripted Fake so the scenario is repeatable. Reports per-question
results and the median/p95 time from the question's final caption to its card (target 2.5 s).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[1] / "services" / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import issue_token  # noqa: E402
from app.main import app  # noqa: E402
from app.meetings.store import InMemoryMeetingStore, Meeting, Segment, new_id  # noqa: E402
from app.providers.stt.base import FakeSttAdapter  # noqa: E402
from app.router import InMemoryQuotaStore, load_config  # noqa: E402
from app.services import Services, build_services, set_services  # noqa: E402

TARGET_MEDIAN_MS = 2500
SECONDS_PER_LINE = 1.0


def scenario() -> dict:
    return json.loads((HERE / "questions.json").read_text())


def make_services(real: bool = False, client=None) -> Services:
    sc = scenario()
    script = [(x["text"], x["speaker"]) for x in sc["live"]]
    kw = {} if real else {}
    if client is not None:
        kw["client"] = client
    return build_services(
        config=load_config(), store=InMemoryQuotaStore(), meetings=InMemoryMeetingStore(),
        stt_factory=lambda d, _c: FakeSttAdapter(d.id, script, seconds_per_line=SECONDS_PER_LINE), **kw,
    )


def run(services: Services, user: str = "eval-user") -> dict:
    sc = scenario()
    set_services(services)
    h = {"Authorization": f"Bearer {issue_token(user)}"}
    try:
        with TestClient(app) as client:
            assert client.put("/me/profile", json=sc["profile"], headers=h).status_code == 200
            # A past meeting holds the facts the answers must come from.
            prior = Meeting(new_id(), user, "review", sc["prior_meeting"]["title"], "cloud", "private")
            store = services.meetings

            async def seed() -> None:
                await store.create(prior)
                for i, (who, text) in enumerate(sc["prior_meeting"]["lines"]):
                    await store.add_segment(Segment(prior.id, f"seg_{i}", "system", who, text, i * 10_000, i * 10_000 + 5000, "eval"))

            client.portal.call(seed)
            client.post(f"/meetings/{prior.id}/end", headers=h)
            for _ in range(500):
                if client.get(f"/meetings/{prior.id}/summary", headers=h).json()["status"] in ("ready", "failed"):
                    break
                time.sleep(0.01)

            m = client.post("/meetings", json={"type": "planning", "title": "Release sync"}, headers=h).json()
            n = len(sc["live"])
            silence = b"\x01" + b"\x00" * 640
            final_at: dict[str, float] = {}
            events: list[dict] = []
            with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
                ws.receive_json()
                for _ in range(int(n * SECONDS_PER_LINE * 50) + 5):
                    ws.send_bytes(silence)
                expected_cards = sum(x["expect"] in ("card", "no_answer") for x in sc["live"])
                deadline = time.time() + 60
                while time.time() < deadline:
                    e = ws.receive_json()
                    events.append(e | {"_t": time.perf_counter()})
                    if e["type"] == "transcript.final":
                        final_at[e["segment_id"]] = time.perf_counter()
                    if sum(x["type"] == "card.created" for x in events) >= expected_cards and \
                            sum(x["type"] == "transcript.final" for x in events) >= n:
                        break
                time.sleep(0.2)  # let deltas and stray events land
            client.post(f"/meetings/{m['meeting_id']}/end", headers=h)
            cards_api = client.get(f"/meetings/{m['meeting_id']}/cards", headers=h).json()
    finally:
        set_services(None)

    finals = [e for e in events if e["type"] == "transcript.final"]
    detected = {e["segment_id"]: e for e in events if e["type"] == "question.detected"}
    cards = [e for e in events if e["type"] == "card.created"]
    deltas = [e for e in events if e["type"] == "card.delta"]
    rows, latencies = [], []
    for i, x in enumerate(sc["live"]):
        seg = finals[i]["segment_id"] if i < len(finals) else None
        d = detected.get(seg)
        card = None
        if d and d["addressed_to_me"]:
            # The card for this question is the next card.created after its detection.
            card = next((c for c in cards if c["_t"] >= d["_t"]), None)
        text = card and (card["text"] + "".join(dl["text"] for dl in deltas if dl["card_id"] == card["card_id"]))
        got = ("none" if not d else "not_me" if not d["addressed_to_me"] else
               "no_answer" if card and card["confidence"] == 0 else "card" if card else "missing")
        ok = got == x["expect"] or (x["expect"] == "none" and got == "none")
        if x["expect"] == "card":
            ok = ok and bool(card and card["sources"]) and x["cites"].lower() in (text or "").lower()
        if card and seg in final_at:
            latencies.append((card["_t"] - final_at[seg]) * 1000)
        rows.append({"text": x["text"], "expect": x["expect"], "got": got, "ok": ok,
                     "card": text, "provider": card and card["provider"]})
    report = {
        "passed": sum(r["ok"] for r in rows), "total": len(rows), "rows": rows,
        "latency_ms": {"median": round(statistics.median(latencies)) if latencies else None,
                       "p95": round(sorted(latencies)[int(0.95 * (len(latencies) - 1))]) if latencies else None,
                       "target_median": TARGET_MEDIAN_MS},
        "switches": [e for e in events if e["type"] == "provider.switched"],
        "saved_cards": len(cards_api),
    }
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true")
    args = ap.parse_args()
    if args.real:
        import os

        os.environ.pop("COPILOT_FAKE_PROVIDERS", None)
        from app.router.client import LiteLLMClient

        services = make_services(real=True, client=LiteLLMClient())
    else:
        services = make_services()
    report = run(services)
    for r in report["rows"]:
        print(("ok  " if r["ok"] else "FAIL") + f" expect={r['expect']:<9} got={r['got']:<9} {r['text']}")
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=2, default=str))
    ok = report["passed"] == report["total"] and (report["latency_ms"]["median"] or 0) <= TARGET_MEDIAN_MS
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
