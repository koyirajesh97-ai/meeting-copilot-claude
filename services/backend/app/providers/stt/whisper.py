"""Whisper-based fallbacks: Groq's hosted whisper-large-v3 and local faster-whisper."""

from __future__ import annotations

import asyncio
import os
from functools import lru_cache

import httpx

from .base import SttError, SttOptions, SttUnavailable
from .chunked import ChunkedSession, to_wav

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


class GroqWhisperAdapter:
    def __init__(self, model: str = "whisper-large-v3", key_env: str = "GROQ_API_KEY") -> None:
        self.name = f"groq/{model}"
        self.model = model
        self.key_env = key_env

    def available(self) -> bool:
        return bool(os.environ.get(self.key_env))

    async def _transcribe(self, pcm: bytes, opts: SttOptions) -> str:
        key = os.environ.get(self.key_env)
        data = {
            "model": self.model,
            "language": opts.language,
            "response_format": "json",
            "temperature": "0",
        }
        if opts.keyterms:
            # Whisper's prompt nudges spelling of names and jargon.
            data["prompt"] = "Vocabulary: " + ", ".join(opts.keyterms[:50])
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {key}"},
                data=data,
                files={"file": ("chunk.wav", to_wav(pcm), "audio/wav")},
            )
        if r.status_code == 429:
            raise SttError("Groq Whisper rate limited (429)")
        if r.status_code >= 400:
            raise SttError(f"Groq Whisper error {r.status_code}: {r.text[:200]}")
        return r.json().get("text", "")

    async def open(self, opts: SttOptions) -> ChunkedSession:
        if not self.available():
            raise SttUnavailable(f"{self.key_env} is not set")
        return ChunkedSession(self._transcribe, opts)


@lru_cache(maxsize=2)
def _load_local_model(model: str):
    from faster_whisper import WhisperModel  # optional dependency

    return WhisperModel(model, device="cpu", compute_type="int8")


class LocalWhisperAdapter:
    """faster-whisper on this machine. Install with `uv sync --extra local`. Slow without a GPU."""

    def __init__(self, model: str = "small.en") -> None:
        self.name = f"local/{model}"
        self.model = model

    def available(self) -> bool:
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False
        return True

    async def _transcribe(self, pcm: bytes, opts: SttOptions) -> str:
        import numpy as np

        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768

        def run() -> str:
            model = _load_local_model(self.model)
            prompt = ", ".join(opts.keyterms[:50]) or None
            segments, _ = model.transcribe(
                audio, language=opts.language, initial_prompt=prompt, vad_filter=False
            )
            return " ".join(s.text.strip() for s in segments)

        return await asyncio.to_thread(run)

    async def open(self, opts: SttOptions) -> ChunkedSession:
        if not self.available():
            raise SttUnavailable("faster-whisper is not installed (uv sync --extra local)")
        return ChunkedSession(self._transcribe, opts)
