"""Send one tiny request to every configured provider; print status, latency and quota hints.

Run: scripts/check-providers  (or: uv run python -m app.router.check [--json])
Providers whose key isn't set are reported as "skipped", not failed. Exit code 1 if any
configured provider fails. Uses data_class "test" content only.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time

import httpx

from .client import LiteLLMClient, ProviderError
from .config import Deployment, RouterConfig, load_config

PING = [{"role": "user", "content": 'Reply with the JSON {"ok": true} and nothing else.'}]


async def check_llm(cfg: RouterConfig, d: Deployment) -> dict:
    p = cfg.provider(d.provider)
    if not p.api_key:
        return {"status": "skipped", "detail": f"{p.key_env} not set"}
    t0 = time.perf_counter()
    try:
        r = await LiteLLMClient().complete(d, p, PING, timeout=20, json_mode=False)
    except ProviderError as e:
        return {
            "status": "fail",
            "detail": str(e)[:200],
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }
    hints = {k: v for k, v in r.headers.items() if k.startswith("x-ratelimit-remaining")}
    return {
        "status": "ok",
        "latency_ms": int((time.perf_counter() - t0) * 1000),
        "tokens": r.total_tokens,
        "remaining": hints,
    }


async def check_stt(cfg: RouterConfig, d: Deployment) -> dict:
    p = cfg.provider(d.provider)
    t0 = time.perf_counter()
    if d.provider == "local":
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return {"status": "skipped", "detail": "faster-whisper not installed"}
        return {"status": "ok", "latency_ms": 0}
    key = p.api_key
    if not key:
        return {"status": "skipped", "detail": f"{p.key_env} not set"}
    if d.provider == "deepgram":
        req = ("GET", "https://api.deepgram.com/v1/projects", {"Authorization": f"Token {key}"})
    elif d.provider == "gladia":
        req = ("GET", "https://api.gladia.io/v2/live?limit=1", {"x-gladia-key": key})
    elif d.provider == "groq":
        req = (
            "GET",
            f"https://api.groq.com/openai/v1/models/{d.model}",
            {"Authorization": f"Bearer {key}"},
        )
    else:
        return {"status": "skipped", "detail": "no check for this provider"}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            resp = await c.request(req[0], req[1], headers=req[2])
    except httpx.HTTPError as e:
        return {"status": "fail", "detail": str(e)[:200]}
    ms = int((time.perf_counter() - t0) * 1000)
    if resp.status_code >= 400:
        return {
            "status": "fail",
            "detail": f"HTTP {resp.status_code}: {resp.text[:150]}",
            "latency_ms": ms,
        }
    return {"status": "ok", "latency_ms": ms}


async def run(cfg: RouterConfig) -> list[dict]:
    seen: dict[str, tuple[Deployment, str]] = {}
    for task, chain in cfg.tasks.items():
        for d in chain:
            seen.setdefault(d.id, (d, task))
    jobs = []
    for d, task in seen.values():
        fn = check_stt if task.startswith("stt_") else check_llm
        jobs.append(fn(cfg, d))
    results = await asyncio.gather(*jobs)
    return [{"deployment": d.id, **r} for (d, _), r in zip(seen.values(), results, strict=True)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true", help="print JSON instead of a table")
    args = ap.parse_args()
    results = asyncio.run(run(load_config()))
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for r in results:
            extra = r.get("detail") or ", ".join(
                f"{k}={v}" for k, v in (r.get("remaining") or {}).items()
            )
            print(
                f"{r['status']:8} {r['deployment']:40} {str(r.get('latency_ms', '-')) + ' ms':>9}  {extra}"
            )
    failed = [r for r in results if r["status"] == "fail"]
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write("| Status | Provider | Latency | Detail |\n|---|---|---|---|\n")
            for r in results:
                f.write(
                    f"| {r['status']} | {r['deployment']} | {r.get('latency_ms', '-')} | {r.get('detail', '')} |\n"
                )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
