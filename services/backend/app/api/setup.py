"""First-run setup: which AI keys the backend has, and a wizard step that tests each key.

Keys belong to the backend, never the desktop app. The wizard sends a key once, the backend
tests it with one tiny request, and saves it only when the backend runs on this computer
(the request comes from localhost and COPILOT_ENV_FILE names its .env file)."""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.auth import CurrentUser
from app.router.config import RouterConfig
from app.services import fake_providers_enabled, services

router = APIRouter()
_lock = asyncio.Lock()


class ProviderKey(BaseModel):
    provider: str
    key_env: str
    has_key: bool
    signup_url: str | None
    trains_on_data: bool | str
    tasks: list[str]
    #: Groq, Mistral and Deepgram cover every task; the rest are extra fallbacks.
    required: bool


REQUIRED = {"groq", "mistral", "deepgram"}


def _local_request(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1", "localhost", "testclient")


@router.get("/setup/providers", response_model=list[ProviderKey])
async def providers(_user: CurrentUser) -> list[ProviderKey]:
    cfg = services().config
    out = []
    for name, p in cfg.providers.items():
        if not p.key_env:
            continue
        tasks = sorted(
            t for t, chain in cfg.tasks.items() if any(d.provider == name for d in chain)
        )
        out.append(
            ProviderKey(
                provider=name,
                key_env=p.key_env,
                has_key=bool(p.api_key),
                signup_url=p.signup_url,
                trains_on_data=p.trains_on_data,
                tasks=tasks,
                required=name in REQUIRED,
            )
        )
    return sorted(out, key=lambda x: (not x.required, x.provider))


class KeyIn(BaseModel):
    provider: str = Field(max_length=50)
    key: str = Field(min_length=8, max_length=500)
    save: bool = True


class KeyResult(BaseModel):
    ok: bool
    detail: str
    saved: bool
    #: When it can't be saved here: the line to add to the backend's environment.
    env_line: str | None = None


async def test_key(cfg: RouterConfig, provider: str, key: str) -> tuple[bool, str]:
    """One tiny request with this key (the same checks as scripts/check-providers)."""
    from app.router import check

    if fake_providers_enabled():
        return (
            key != "bad-key-bad-key",
            "ok (Fake mode)" if key != "bad-key-bad-key" else "Fake provider rejected the key",
        )
    p = cfg.provider(provider)
    found = next(
        ((d, t) for t, chain in cfg.tasks.items() for d in chain if d.provider == provider), None
    )
    if found is None:
        return False, "No task uses this provider"
    d, task = found
    async with _lock:  # the checks read keys from the environment
        old = os.environ.get(p.key_env)
        os.environ[p.key_env] = key
        try:
            fn = (
                check.check_stt
                if task.startswith("stt_")
                else check.check_embed
                if task == "embed"
                else check.check_llm
            )
            r = await fn(cfg, d)
        finally:
            if old is None:
                os.environ.pop(p.key_env, None)
            else:
                os.environ[p.key_env] = old
    return r["status"] in ("ok", "limits_changed"), str(
        r.get("detail") or f"{r['status']} in {r.get('latency_ms', '?')} ms"
    )


def save_env(path: Path, name: str, value: str) -> None:
    """Set NAME=value in a .env file (replacing an existing line), readable only by you."""
    lines = path.read_text().splitlines() if path.exists() else []
    pat = re.compile(rf"^\s*{re.escape(name)}\s*=")
    line = f"{name}={value}"
    lines = (
        [line if pat.match(x) else x for x in lines]
        if any(pat.match(x) for x in lines)
        else [*lines, line]
    )
    path.write_text("\n".join(lines) + "\n")
    path.chmod(0o600)


@router.post("/setup/keys", response_model=KeyResult)
async def add_key(body: KeyIn, request: Request, _user: CurrentUser) -> KeyResult:
    cfg = services().config
    p = cfg.providers.get(body.provider)
    if p is None or not p.key_env:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown provider")
    key = body.key.strip()
    if not re.fullmatch(r"[\x21-\x7e]+", key):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That doesn't look like an API key"
        )
    ok, detail = await test_key(cfg, body.provider, key)
    if not ok:
        return KeyResult(ok=False, detail=detail, saved=False)
    env_file = os.environ.get("COPILOT_ENV_FILE")
    if body.save and env_file and _local_request(request):
        save_env(Path(env_file), p.key_env, key)
        os.environ[p.key_env] = key  # takes effect now, no restart
        return KeyResult(ok=True, detail=detail, saved=True)
    return KeyResult(ok=True, detail=detail, saved=False, env_line=f"{p.key_env}=…")
