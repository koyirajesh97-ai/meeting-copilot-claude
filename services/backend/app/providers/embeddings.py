"""Text embeddings for search (384 dimensions), with the same fallback and data-policy rules as
LLM calls. Local fastembed is first (no quota, nothing leaves the machine); Cloudflare Workers AI
is the hosted fallback; FakeEmbedder is deterministic for tests and offline runs.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import os
import re
import time
from functools import lru_cache
from typing import Protocol

import httpx

from app.metrics import metrics
from app.router.config import Deployment, RouterConfig
from app.router.policy import DataClass, DataPolicyError, allowed
from app.router.quota import Cooldowns, QuotaTracker

log = logging.getLogger("app.embeddings")

DIMS = 384
TASK = "embed"


class EmbeddingError(RuntimeError):
    pass


class Embedder(Protocol):
    name: str

    def available(self) -> bool: ...

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


def normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


class FakeEmbedder:
    """Hashed bag of words (plus word pairs): texts sharing words get similar vectors."""

    name = "fake/hash-384"

    def available(self) -> bool:
        return True

    async def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for t in texts:
            words = re.findall(r"[a-z0-9]+", t.lower())
            v = [0.0] * DIMS
            for tok in words + [f"{a}_{b}" for a, b in zip(words, words[1:], strict=False)]:
                h = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=8).digest(), "big")
                v[h % DIMS] += 1.0 if (h >> 32) & 1 else -1.0
            out.append(normalize(v))
        return out


@lru_cache(maxsize=1)
def _fastembed_model(model: str):
    from fastembed import TextEmbedding  # optional dependency: uv sync --extra embeddings

    return TextEmbedding(model_name=model)


class FastEmbedder:
    def __init__(self, model: str = "bge-small-en-v1.5") -> None:
        self.name = f"local/{model}"
        self.model = f"BAAI/{model}" if "/" not in model else model

    def available(self) -> bool:
        try:
            import fastembed  # noqa: F401
        except ImportError:
            return False
        return True

    async def embed(self, texts: list[str]) -> list[list[float]]:
        def run() -> list[list[float]]:
            return [
                normalize([float(x) for x in v]) for v in _fastembed_model(self.model).embed(texts)
            ]

        return await asyncio.to_thread(run)


class CloudflareEmbedder:
    def __init__(
        self,
        model: str,
        key_env: str,
        account_env: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.name = f"cloudflare/{model}"
        self.model = model
        self.key_env = key_env
        self.account_env = account_env
        self.transport = transport

    def available(self) -> bool:
        return bool(os.environ.get(self.key_env) and os.environ.get(self.account_env))

    async def embed(self, texts: list[str]) -> list[list[float]]:
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/{os.environ[self.account_env]}"
            f"/ai/run/@cf/baai/{self.model}"
        )
        async with httpx.AsyncClient(timeout=20, transport=self.transport) as c:
            r = await c.post(
                url,
                headers={"Authorization": f"Bearer {os.environ[self.key_env]}"},
                json={"text": texts},
            )
        if r.status_code >= 400:
            raise EmbeddingError(f"Cloudflare embeddings error {r.status_code}: {r.text[:200]}")
        data = r.json()["result"]["data"]
        return [normalize(v) for v in data]


def default_factory(d: Deployment, cfg: RouterConfig) -> Embedder | None:
    p = cfg.provider(d.provider)
    if d.provider == "local":
        return FastEmbedder(d.model)
    if d.provider == "cloudflare":
        return CloudflareEmbedder(
            d.model, p.key_env or "CLOUDFLARE_API_TOKEN", p.account_env or "CLOUDFLARE_ACCOUNT_ID"
        )
    if d.provider == "fake":
        return FakeEmbedder()
    return None


class EmbeddingRouter:
    """Tries `tasks.embed` in order: data policy, cooldowns and daily quotas apply."""

    def __init__(
        self, cfg: RouterConfig, quota: QuotaTracker, cooldowns: Cooldowns, factory=default_factory
    ) -> None:
        self.cfg = cfg
        self.quota = quota
        self.cooldowns = cooldowns
        self.factory = factory
        self._cache: dict[str, Embedder | None] = {}

    def _adapter(self, d: Deployment) -> Embedder | None:
        if d.id not in self._cache:
            self._cache[d.id] = self.factory(d, self.cfg)
        return self._cache[d.id]

    async def embed(
        self, texts: list[str], data_class: DataClass, *, local_only: bool = False
    ) -> tuple[list[list[float]], str]:
        if not texts:
            return [], "none"
        chain = self.cfg.tasks.get(TASK, [])
        tried = []
        blocked = 0
        for d in chain:
            if local_only and not self.cfg.provider(d.provider).local:
                tried.append(f"{d.id}: skipped (Local-only)")
                continue
            if not allowed(self.cfg.provider(d.provider), data_class):
                blocked += 1
                continue
            a = self._adapter(d)
            if (
                a is None
                or not a.available()
                or self.cooldowns.cooling(d)
                or await self.quota.exhausted(d)
            ):
                tried.append(f"{d.id}: unavailable")
                continue
            t0 = time.perf_counter()
            try:
                vecs = await a.embed(texts)
            except Exception as e:
                self.cooldowns.failure(d)
                tried.append(f"{d.id}: {e}")
                continue
            if any(len(v) != DIMS for v in vecs):
                tried.append(f"{d.id}: wrong dimensions")
                continue
            self.cooldowns.success(d)
            await self.quota.record(d, TASK, tokens=sum(len(t) for t in texts) // 4)
            metrics.record("embed.ms", (time.perf_counter() - t0) * 1000, d.id)
            return vecs, d.id
        if chain and blocked == len(chain):
            raise DataPolicyError("Every embedding provider may train on meeting data.")
        raise EmbeddingError(
            f"No embedding provider available ({'; '.join(tried) or 'empty chain'})"
        )
