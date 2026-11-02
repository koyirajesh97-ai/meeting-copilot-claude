"""Run every prompt's fixture (evals/prompts/fixtures.json) and check the answer.

pytest runs this with the Fake provider. To try the real free providers (test data only):
    uv run python -m tests.prompt_check --real
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.prompts import all_names, load
from app.router.router import Router
from app.services import build_services

FIXTURES = Path(__file__).resolve().parents[3] / "evals" / "prompts" / "fixtures.json"

# Which router task each prompt runs as.
TASK = {
    "question_detector": "detect",
    "answer_card": "card",
    "catch_up": "catchup",
    "clarify": "clarify",
    "standup_script": "standup",
    "summary_map": "summary",
    "summary_reduce": "summary",
    "follow_up": "card",
    "ask": "ask",
}


def fixtures() -> dict[str, dict]:
    return json.loads(FIXTURES.read_text())


def check(name: str, out: dict, expect: dict) -> list[str]:
    problems = []
    for key, want in expect.items():
        if key in ("is_question", "addressed_to_me") and out.get(key) is not want:
            problems.append(f"{key} should be {want}")
        elif key == "cites" and want not in json.dumps(out):
            problems.append(f"should cite {want}")
        elif key.endswith("_min") and len(out.get(key.removesuffix("_min"), [])) < want:
            problems.append(f"{key.removesuffix('_min')} needs at least {want}")
        elif key == "plain_contains" and want.lower() not in out.get("plain", "").lower():
            problems.append(f"plain should contain {want!r}")
        elif key == "keeps" and want not in json.dumps(out):
            problems.append(f"should keep {want!r} exactly")
        elif key == "draft_min_words" and len(out.get("draft", "").split()) < want:
            problems.append("draft too short")
    return problems


async def run_one(router: Router, name: str, fx: dict) -> tuple[dict, list[str]]:
    messages = load(name).render(**fx["vars"])
    out = await router.complete(TASK[name], messages, "test", json_mode=True)
    return out.json, check(name, out.json, fx["expect"])


async def run_all(router: Router) -> dict[str, list[str]]:
    fx = fixtures()
    missing = set(all_names()) - set(fx)
    if missing:
        raise AssertionError(f"prompts without fixtures: {sorted(missing)}")
    return {name: (await run_one(router, name, fx[name]))[1] for name in all_names()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true")
    args = ap.parse_args()
    if args.real:
        router = build_services().router
    else:
        from app.router.client import FakeClient
        from app.router.fake_responses import fake_responder

        router = build_services(client=FakeClient(responder=fake_responder)).router
    results = asyncio.run(run_all(router))
    for name, problems in results.items():
        print(f"{'ok  ' if not problems else 'FAIL'} {name} {'; '.join(problems)}")
    return 1 if any(results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
