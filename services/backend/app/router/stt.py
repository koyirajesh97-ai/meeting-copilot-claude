"""Live STT through the same fallback order, data policy, quota and cooldown rules as LLMs.

`open()` returns the first adapter in config `tasks.stt_live` that's allowed, available and
not cooling down. Usage is counted in audio seconds. The realtime gateway calls `open()` again
with `exclude` when a session fails mid-meeting.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from app.providers.stt.base import SttAdapter, SttError, SttOptions, SttSession, SttUnavailable

from .config import Deployment, RouterConfig
from .policy import DataClass, DataPolicyError, allowed
from .quota import Cooldowns, QuotaTracker

log = logging.getLogger("app.router.stt")

TASK = "stt_live"


def default_adapter_factory(d: Deployment, cfg: RouterConfig) -> SttAdapter | None:
    from app.providers.stt.deepgram import DeepgramAdapter
    from app.providers.stt.gladia import GladiaAdapter
    from app.providers.stt.whisper import GroqWhisperAdapter, LocalWhisperAdapter

    p = cfg.provider(d.provider)
    match d.provider:
        case "deepgram":
            return DeepgramAdapter(d.model, key_env=p.key_env or "DEEPGRAM_API_KEY")
        case "gladia":
            return GladiaAdapter(d.model, key_env=p.key_env or "GLADIA_API_KEY")
        case "groq":
            return GroqWhisperAdapter(d.model, key_env=p.key_env or "GROQ_API_KEY")
        case "local":
            # The provider's `model` (e.g. small.en) names the Whisper weights to load.
            return LocalWhisperAdapter(p.model or d.model)
    return None


@dataclass
class OpenedStt:
    deployment: Deployment
    session: SttSession
    skipped: list[dict[str, str]]


class SttRegistry:
    def __init__(
        self,
        config: RouterConfig,
        quota: QuotaTracker,
        cooldowns: Cooldowns,
        factory: Callable[[Deployment, RouterConfig], SttAdapter | None] = default_adapter_factory,
    ) -> None:
        self.config = config
        self.quota = quota
        self.cooldowns = cooldowns
        self._adapters: dict[str, SttAdapter | None] = {}
        self._factory = factory

    def adapter(self, d: Deployment) -> SttAdapter | None:
        if d.id not in self._adapters:
            self._adapters[d.id] = self._factory(d, self.config)
        return self._adapters[d.id]

    @property
    def chain(self) -> list[Deployment]:
        return self.config.tasks.get(TASK, [])

    async def open(
        self,
        data_class: DataClass,
        opts: SttOptions,
        *,
        exclude: set[str] | frozenset[str] = frozenset(),
        allow_test_only: bool = False,
    ) -> OpenedStt:
        skipped: list[dict[str, str]] = []
        blocked = 0
        for d in self.chain:
            if d.id in exclude:
                skipped.append({"deployment": d.id, "outcome": "failed earlier in this meeting"})
                continue
            if not allowed(self.config.provider(d.provider), data_class, allow_test_only):
                blocked += 1
                skipped.append(
                    {"deployment": d.id, "outcome": "blocked: may train on meeting data"}
                )
                continue
            if self.cooldowns.cooling(d):
                skipped.append({"deployment": d.id, "outcome": "cooling down"})
                continue
            if await self.quota.exhausted(d):
                skipped.append({"deployment": d.id, "outcome": "daily quota at 95%"})
                continue
            adapter = self.adapter(d)
            if adapter is None or not adapter.available():
                skipped.append({"deployment": d.id, "outcome": "not configured"})
                continue
            try:
                session = await adapter.open(opts)
            except SttUnavailable as e:
                skipped.append({"deployment": d.id, "outcome": f"unavailable: {e}"})
                continue
            except SttError as e:
                self.cooldowns.failure(d)
                skipped.append({"deployment": d.id, "outcome": f"error: {e}"})
                continue
            self.cooldowns.success(d)
            log.info("stt opened provider=%s skipped=%s", d.id, skipped)
            return OpenedStt(d, session, skipped)
        if self.chain and blocked == len(self.chain):
            raise DataPolicyError("Every live transcription provider may train on meeting audio.")
        raise SttError(f"No live transcription provider available ({skipped})")

    def failed(self, d: Deployment) -> None:
        self.cooldowns.failure(d)

    async def record_audio(self, d: Deployment, seconds: float) -> float | None:
        """Count audio sent to a provider. Returns percent used on first crossing of 80%."""
        return await self.quota.record(d, TASK, audio_seconds=seconds, requests=0)
