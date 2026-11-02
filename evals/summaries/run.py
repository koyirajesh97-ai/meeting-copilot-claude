"""Summary eval: action-item recall on fixture transcripts (target 90%).

    cd services/backend
    uv run python ../../evals/summaries/run.py            # Fake provider (what CI runs)
    uv run python ../../evals/summaries/run.py --real     # the free providers in config/providers.yaml
    uv run python ../../evals/summaries/run.py --real --long   # plus a 60-minute transcript, timed

An expected item counts as found when one extracted action item contains all its keywords.
Owner/due checks are reported separately (they must match when the item says so).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[1] / "services" / "backend"))

from app.meetings.store import Segment  # noqa: E402
from app.router.router import Router  # noqa: E402
from app.services import build_services  # noqa: E402
from app.summaries.pipeline import summarize  # noqa: E402
from app.summaries.templates import template_for  # noqa: E402

TARGET = 0.9


def load_fixtures() -> list[dict]:
    return [json.loads(p.read_text()) | {"name": p.stem} for p in sorted((HERE / "fixtures").glob("*.json"))]


def segments_for(fx: dict, repeat: int = 1) -> tuple[list[Segment], dict[str, str]]:
    speakers = sorted({who for who, _ in fx["transcript"]})
    label = {who: f"spk_{i}" for i, who in enumerate(speakers)}
    segs, t = [], 0
    for r in range(repeat):
        for i, (who, text) in enumerate(fx["transcript"]):
            segs.append(Segment("eval", f"seg_{r}_{i}", "system", label[who], text, t, t + 4000, "eval"))
            t += 5000
    return segs, {v: k for k, v in label.items()}


async def score(router: Router, fx: dict) -> dict:
    segs, names = segments_for(fx)
    result = await summarize(router, fx["meeting_type"], segs, template_for(fx["meeting_type"]), names, "test")
    items = result.summary.action_items
    found = details = 0
    misses, owner_ok, owner_total = [], 0, 0
    for exp in fx["expected_action_items"]:
        match = next((a for a in items if all(k in a.text.lower() for k in exp["keywords"])), None)
        if match is None:
            misses.append(exp["keywords"])
            continue
        found += 1
        for field, attr in [("owner", "owner"), ("due", "due_date")]:
            if field in exp:
                owner_total += 1
                if (getattr(match, attr) or "").lower() == exp[field].lower():
                    owner_ok += 1
    details = {"owner_due_correct": owner_ok, "owner_due_total": owner_total}
    return {"name": fx["name"], "expected": len(fx["expected_action_items"]), "found": found, "missed": misses,
            "provider": result.provider, "ms": result.latency_ms, **details}


async def run(router: Router, long: bool = False) -> dict:
    rows = [await score(router, fx) for fx in load_fixtures()]
    expected = sum(r["expected"] for r in rows)
    found = sum(r["found"] for r in rows)
    report = {"recall": round(found / expected, 3), "target": TARGET, "fixtures": rows}
    if long:
        fx = load_fixtures()[0]
        segs, names = segments_for(fx, repeat=90)  # ~60 minutes at 5 s per line
        t0 = time.perf_counter()
        r = await summarize(router, fx["meeting_type"], segs, template_for(fx["meeting_type"]), names, "test")
        report["long"] = {"minutes": round(segs[-1].end_ms / 60000), "chunks": r.chunks,
                          "seconds": round(time.perf_counter() - t0, 1), "target_seconds": 60}
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true", help="use the providers in config/providers.yaml")
    ap.add_argument("--long", action="store_true", help="also time a 60-minute transcript")
    args = ap.parse_args()
    if args.real:
        services = build_services()
    else:
        from app.router.client import FakeClient
        from app.router.fake_responses import fake_responder

        services = build_services(client=FakeClient(responder=fake_responder))
    report = asyncio.run(run(services.router, args.long))
    print(json.dumps(report, indent=2))
    return 0 if report["recall"] >= TARGET else 1


if __name__ == "__main__":
    sys.exit(main())
