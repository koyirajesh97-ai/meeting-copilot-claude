"""Speech-to-text for engines without streaming (Groq Whisper, local faster-whisper).

Audio is cut into 5–10 s chunks at a pause (300 ms of quiet) and each chunk is transcribed
as one final result. No partials, so captions lag more than with streaming providers.
"""

from __future__ import annotations

import array
import asyncio
import io
import math
import wave
from collections.abc import AsyncIterator, Awaitable, Callable

from .base import BYTES_PER_SECOND, ResultQueue, SttError, SttOptions, SttResult

FRAME_BYTES = 640  # 20 ms
QUIET_DBFS = -45.0


def frame_dbfs(frame: bytes) -> float:
    a = array.array("h", frame)
    if not a:
        return -math.inf
    rms = math.sqrt(sum(s * s for s in a) / len(a)) / 32768
    return 20 * math.log10(rms) if rms > 0 else -math.inf


def to_wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16_000)
        w.writeframes(pcm)
    return buf.getvalue()


class Chunker:
    """Collects PCM and yields (start_ms, pcm) chunks of min_s..max_s, cut at a pause."""

    def __init__(self, min_s: float = 5.0, max_s: float = 10.0, pause_ms: int = 300) -> None:
        self.min_bytes = int(min_s * BYTES_PER_SECOND)
        self.max_bytes = int(max_s * BYTES_PER_SECOND)
        self.pause_frames = pause_ms // 20
        self._buf = bytearray()
        self._pending = bytearray()  # partial frame
        self._quiet_run = 0
        self._offset_bytes = 0

    def push(self, pcm: bytes) -> list[tuple[int, bytes]]:
        out: list[tuple[int, bytes]] = []
        self._pending += pcm
        while len(self._pending) >= FRAME_BYTES:
            frame = bytes(self._pending[:FRAME_BYTES])
            del self._pending[:FRAME_BYTES]
            self._buf += frame
            self._quiet_run = self._quiet_run + 1 if frame_dbfs(frame) < QUIET_DBFS else 0
            at_pause = len(self._buf) >= self.min_bytes and self._quiet_run >= self.pause_frames
            if at_pause or len(self._buf) >= self.max_bytes:
                out.append(self._cut())
        return out

    def flush(self) -> list[tuple[int, bytes]]:
        self._buf += self._pending
        self._pending.clear()
        return [self._cut()] if self._buf else []

    def _cut(self) -> tuple[int, bytes]:
        start_ms = self._offset_bytes * 1000 // BYTES_PER_SECOND
        chunk = bytes(self._buf)
        self._offset_bytes += len(chunk)
        self._buf.clear()
        self._quiet_run = 0
        return start_ms, chunk


Transcribe = Callable[[bytes, SttOptions], Awaitable[str]]


class ChunkedSession:
    def __init__(
        self, transcribe: Transcribe, opts: SttOptions, chunker: Chunker | None = None
    ) -> None:
        self._transcribe = transcribe
        self._opts = opts
        self._chunker = chunker or Chunker()
        self._queue = ResultQueue()
        self._work: asyncio.Queue[tuple[int, bytes] | None] = asyncio.Queue()
        self._worker = asyncio.create_task(self._run())
        self._closed = False

    async def send(self, pcm: bytes) -> None:
        if self._closed:
            return
        for chunk in self._chunker.push(pcm):
            self._work.put_nowait(chunk)

    def results(self) -> AsyncIterator[SttResult]:
        return aiter(self._queue)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for chunk in self._chunker.flush():
            self._work.put_nowait(chunk)
        self._work.put_nowait(None)
        await self._worker

    async def _run(self) -> None:
        while True:
            item = await self._work.get()
            if item is None:
                self._queue.end()
                return
            start_ms, pcm = item
            if all(
                frame_dbfs(pcm[i : i + FRAME_BYTES]) < QUIET_DBFS
                for i in range(0, len(pcm), FRAME_BYTES)
            ):
                continue  # silence: don't spend a request on it
            try:
                text = (await self._transcribe(pcm, self._opts)).strip()
            except Exception as e:
                self._closed = True
                self._queue.fail(e if isinstance(e, SttError) else SttError(str(e)))
                return
            if text:
                end_ms = start_ms + len(pcm) * 1000 // BYTES_PER_SECOND
                self._queue.put(SttResult(text, True, start_ms, end_ms))
