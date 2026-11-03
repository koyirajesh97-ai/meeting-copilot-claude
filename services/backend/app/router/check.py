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

#: Response headers that report a provider's limits, and the config field each one maps to.
LIMIT_HEADERS = {
    "groq": {"x-ratelimit-limit-requests": "rpd", "x-ratelimit-limit-tokens": "tpm"},
}


def limit_changes(cfg: RouterConfig, d: Deployment, headers: dict[str, str]) -> list[str]:
    """Limits the provider reports that differ from config/providers.yaml."""
    limits = cfg.limits(d)
    out = []
    for header, field in LIMIT_HEADERS.get(d.provider, {}).items():
        reported, configured = headers.get(header), getattr(limits, field)
        if (
            reported
            and reported.isdigit()
            and configured is not None
            and int(reported) != configured
        ):
            out.append(f"{field} is {reported} (config says {configured})")
    return out


async def model_listed(cfg: RouterConfig, d: Deployment, transport=None) -> bool | None:
    """Whether the provider still lists the model (None when the list can't be read)."""
    p = cfg.provider(d.provider)
    if not p.base_url or not p.api_key or p.local:
        return None
    try:
        async with httpx.AsyncClient(timeout=15, transport=transport) as c:
            r = await c.get(
                f"{p.base_url.rstrip('/')}/models", headers={"Authorization": f"Bearer {p.api_key}"}
            )
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    ids = {str(m.get("id", "")).removeprefix("models/") for m in r.json().get("data", [])}
    return d.model in ids if ids else None


async def check_llm(cfg: RouterConfig, d: Deployment) -> dict:
    p = cfg.provider(d.provider)
    if p.local:
        return {"status": "skipped", "detail": "runs on this machine"}
    if not p.api_key:
        return {"status": "skipped", "detail": f"{p.key_env} not set"}
    if await model_listed(cfg, d) is False:
        return {"status": "model_missing", "detail": f"{d.provider} no longer lists {d.model}"}
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
    out = {
        "status": "ok",
        "latency_ms": int((time.perf_counter() - t0) * 1000),
        "tokens": r.total_tokens,
        "remaining": hints,
    }
    if changes := limit_changes(cfg, d, r.headers):
        out |= {"status": "limits_changed", "detail": "; ".join(changes)}
    return out


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


async def check_embed(cfg: RouterConfig, d: Deployment) -> dict:
    from app.providers.embeddings import DIMS, default_factory

    a = default_factory(d, cfg)
    if a is None or not a.available():
        return {"status": "skipped", "detail": "not installed or no key"}
    t0 = time.perf_counter()
    try:
        [v] = await a.embed(["provider check"])
    except Exception as e:
        return {"status": "fail", "detail": str(e)[:200]}
    ms = int((time.perf_counter() - t0) * 1000)
    return {
        "status": "ok" if len(v) == DIMS else "fail",
        "latency_ms": ms,
        "detail": f"{len(v)} dims",
    }


async def run(cfg: RouterConfig) -> list[dict]:
    seen: dict[str, tuple[Deployment, str]] = {}
    for task, chain in cfg.tasks.items():
        for d in chain:
            seen.setdefault(d.id, (d, task))
    jobs = []
    for d, task in seen.values():
        fn = check_stt if task.startswith("stt_") else check_embed if task == "embed" else check_llm
        jobs.append(fn(cfg, d))
    results = await asyncio.gather(*jobs)
    return [{"deployment": d.id, **r} for (d, _), r in zip(seen.values(), results, strict=True)]


#: Statuses that need a person: the nightly job opens an issue for them.
PROBLEMS = ("fail", "model_missing", "limits_changed")


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
    failed = [r for r in results if r["status"] in PROBLEMS]
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
