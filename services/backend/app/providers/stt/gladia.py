"""Gladia v2 live transcription. Docs: https://docs.gladia.io/api-reference/v2/live/init"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from collections.abc import AsyncIterator

import httpx
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

from .base import ResultQueue, SttError, SttOptions, SttResult, SttUnavailable

INIT_URL = "https://api.gladia.io/v2/live"


class GladiaSession:
    def __init__(self, ws: ClientConnection) -> None:
        self._ws = ws
        self._queue = ResultQueue()
        self._closing = False
        self._reader = asyncio.create_task(self._read())

    async def send(self, pcm: bytes) -> None:
        try:
            await self._ws.send(pcm)
        except ConnectionClosed as e:
            raise SttError(f"Gladia socket closed: {e}") from e

    def results(self) -> AsyncIterator[SttResult]:
        return aiter(self._queue)

    async def close(self) -> None:
        if self._closing:
            return
        self._closing = True
        with contextlib.suppress(ConnectionClosed):
            await self._ws.send(json.dumps({"type": "stop_recording"}))
        try:
            await asyncio.wait_for(self._reader, timeout=10)
        except TimeoutError:
            self._reader.cancel()
            self._queue.end()

    async def _read(self) -> None:
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                if msg.get("type") != "transcript":
                    continue
                data = msg.get("data") or {}
                u = data.get("utterance") or {}
                if not u.get("text"):
                    continue
                speaker = u.get("speaker")
                self._queue.put(
                    SttResult(
                        text=u["text"].strip(),
                        is_final=bool(data.get("is_final")),
                        start_ms=round(float(u.get("start", 0)) * 1000),
                        end_ms=round(float(u.get("end", 0)) * 1000),
                        speaker=None if speaker is None else str(speaker),
                    )
                )
            self._queue.end() if self._closing else self._queue.fail(
                SttError("Gladia closed the stream")
            )
        except ConnectionClosed as e:
            self._queue.end() if self._closing else self._queue.fail(
                SttError(f"Gladia connection lost: {e}")
            )


class GladiaAdapter:
    def __init__(self, model: str = "live", key_env: str = "GLADIA_API_KEY") -> None:
        self.name = f"gladia/{model}"
        self.key_env = key_env

    def available(self) -> bool:
        return bool(os.environ.get(self.key_env))

    async def open(self, opts: SttOptions) -> GladiaSession:
        key = os.environ.get(self.key_env)
        if not key:
            raise SttUnavailable(f"{self.key_env} is not set")
        body: dict = {
            "encoding": "wav/pcm",
            "sample_rate": 16000,
            "bit_depth": 16,
            "channels": 1,
            "language_config": {"languages": [opts.language]},
            "messages_config": {"receive_partial_transcripts": True},
        }
        if opts.keyterms:
            body["realtime_processing"] = {
                "custom_vocabulary": True,
                "custom_vocabulary_config": {"vocabulary": list(opts.keyterms[:100])},
            }
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.post(INIT_URL, json=body, headers={"x-gladia-key": key})
                r.raise_for_status()
            ws = await asyncio.wait_for(connect(r.json()["url"]), timeout=5)
        except Exception as e:
            raise SttError(f"Gladia connect failed: {e}") from e
        return GladiaSession(ws)
