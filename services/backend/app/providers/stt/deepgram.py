"""Deepgram live streaming (Nova-3) over WebSocket.

Docs: https://developers.deepgram.com/docs/live-streaming-audio
- mip_opt_out=true opts out of Deepgram's Model Improvement Program for every request.
- keyterm (Nova-3) biases recognition toward project vocabulary.
- KeepAlive every 5 s keeps the socket open while the mic is gated by VAD.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from collections import Counter
from collections.abc import AsyncIterator
from urllib.parse import urlencode

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

from .base import ResultQueue, SttError, SttOptions, SttResult, SttUnavailable

DEFAULT_URL = "wss://api.deepgram.com/v1/listen"
KEEPALIVE_S = 5.0


class DeepgramSession:
    def __init__(self, ws: ClientConnection) -> None:
        self._ws = ws
        self._queue = ResultQueue()
        self._last_send = asyncio.get_running_loop().time()
        self._reader = asyncio.create_task(self._read())
        self._keepalive = asyncio.create_task(self._keep_alive())
        self._closing = False

    async def send(self, pcm: bytes) -> None:
        try:
            await self._ws.send(pcm)
        except ConnectionClosed as e:
            raise SttError(f"Deepgram socket closed: {e}") from e
        self._last_send = asyncio.get_running_loop().time()

    def results(self) -> AsyncIterator[SttResult]:
        return aiter(self._queue)

    async def close(self) -> None:
        if self._closing:
            return
        self._closing = True
        self._keepalive.cancel()
        with contextlib.suppress(ConnectionClosed):
            await self._ws.send(json.dumps({"type": "CloseStream"}))
        try:
            await asyncio.wait_for(self._reader, timeout=5)
        except TimeoutError:
            self._reader.cancel()
            self._queue.end()
        with contextlib.suppress(Exception):
            await self._ws.close()

    async def _keep_alive(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(1)
            if loop.time() - self._last_send >= KEEPALIVE_S:
                with contextlib.suppress(ConnectionClosed):
                    await self._ws.send(json.dumps({"type": "KeepAlive"}))
                self._last_send = loop.time()

    async def _read(self) -> None:
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "Results":
                    r = parse_result(msg)
                    if r:
                        self._queue.put(r)
                elif msg.get("type") == "Error" or "err_code" in msg:
                    self._queue.fail(SttError(f"Deepgram error: {msg}"))
                    return
            if not self._closing:
                self._queue.fail(SttError("Deepgram closed the stream"))
                return
            self._queue.end()
        except ConnectionClosed as e:
            if self._closing:
                self._queue.end()
            else:
                self._queue.fail(SttError(f"Deepgram connection lost: {e}"))


def parse_result(msg: dict) -> SttResult | None:
    alts = (msg.get("channel") or {}).get("alternatives") or []
    if not alts or not alts[0].get("transcript"):
        return None
    alt = alts[0]
    start = float(msg.get("start", 0.0))
    end = start + float(msg.get("duration", 0.0))
    speakers = Counter(w["speaker"] for w in alt.get("words", []) if "speaker" in w)
    speaker = str(speakers.most_common(1)[0][0]) if speakers else None
    return SttResult(
        text=alt["transcript"],
        is_final=bool(msg.get("is_final")),
        start_ms=round(start * 1000),
        end_ms=round(end * 1000),
        speaker=speaker,
    )


class DeepgramAdapter:
    def __init__(
        self, model: str = "nova-3", key_env: str = "DEEPGRAM_API_KEY", url: str | None = None
    ) -> None:
        self.name = f"deepgram/{model}"
        self.model = model
        self.key_env = key_env
        self.url = url or os.environ.get("DEEPGRAM_URL", DEFAULT_URL)

    def available(self) -> bool:
        return bool(os.environ.get(self.key_env))

    def query(self, opts: SttOptions) -> str:
        params: list[tuple[str, str]] = [
            ("model", self.model),
            ("encoding", "linear16"),
            ("sample_rate", "16000"),
            ("channels", "1"),
            ("language", opts.language),
            ("interim_results", "true"),
            ("smart_format", "true"),
            ("punctuate", "true"),
            ("endpointing", "300"),
            ("mip_opt_out", "true"),
            ("diarize", "true" if opts.diarize else "false"),
        ]
        params += [("keyterm", t) for t in opts.keyterms[:100]]
        return urlencode(params)

    async def open(self, opts: SttOptions) -> DeepgramSession:
        key = os.environ.get(self.key_env)
        if not key:
            raise SttUnavailable(f"{self.key_env} is not set")
        try:
            ws = await asyncio.wait_for(
                connect(
                    f"{self.url}?{self.query(opts)}",
                    additional_headers={"Authorization": f"Token {key}"},
                ),
                timeout=5,
            )
        except Exception as e:
            raise SttError(f"Deepgram connect failed: {e}") from e
        return DeepgramSession(ws)
