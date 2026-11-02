"""Live speech-to-text adapter interface. Audio in: 16 kHz mono PCM16 bytes."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

SAMPLE_RATE = 16_000
BYTES_PER_SECOND = SAMPLE_RATE * 2


@dataclass(frozen=True)
class SttOptions:
    language: str = "en"
    #: Project vocabulary (names, systems, acronyms) to bias recognition.
    keyterms: tuple[str, ...] = ()
    #: Separate speakers (system channel only; the mic channel is always "me").
    diarize: bool = False


@dataclass(frozen=True)
class SttResult:
    text: str
    is_final: bool
    start_ms: int
    end_ms: int
    #: Provider's speaker label within this session (e.g. "0"), when diarizing.
    speaker: str | None = None


class SttError(RuntimeError):
    """The session failed; the caller should fall back to the next adapter."""


class SttUnavailable(SttError):
    """The adapter can't run here (no key, library missing)."""


class SttSession(Protocol):
    async def send(self, pcm: bytes) -> None: ...

    def results(self) -> AsyncIterator[SttResult]:
        """Yields results until the session ends; raises SttError if it fails."""
        ...

    async def close(self) -> None:
        """Flush pending audio, let final results arrive, then end `results()`."""
        ...


class SttAdapter(Protocol):
    name: str

    def available(self) -> bool: ...

    async def open(self, opts: SttOptions) -> SttSession: ...


class ResultQueue:
    """Helper for sessions: producers put results/errors, `results()` drains them."""

    _END = object()

    def __init__(self) -> None:
        self._q: asyncio.Queue[object] = asyncio.Queue()

    def put(self, r: SttResult) -> None:
        self._q.put_nowait(r)

    def fail(self, e: Exception) -> None:
        self._q.put_nowait(e)

    def end(self) -> None:
        self._q.put_nowait(self._END)

    async def __aiter__(self) -> AsyncIterator[SttResult]:
        while True:
            item = await self._q.get()
            if item is self._END:
                return
            if isinstance(item, Exception):
                raise item
            yield item  # type: ignore[misc]


@dataclass
class FakeSttSession:
    """Emits a scripted transcript as audio arrives: each script line is spoken over
    `seconds_per_line` of audio, with one partial halfway and a final at the end."""

    script: list[tuple[str, str | None]]
    seconds_per_line: float = 1.0
    fail_after_s: float | None = None
    _queue: ResultQueue = field(default_factory=ResultQueue)
    _bytes: int = 0
    _line: int = 0
    _partial_sent: bool = False
    _closed: bool = False

    async def send(self, pcm: bytes) -> None:
        if self._closed:
            return
        self._bytes += len(pcm)
        elapsed = self._bytes / BYTES_PER_SECOND
        if self.fail_after_s is not None and elapsed >= self.fail_after_s:
            self._closed = True
            self._queue.fail(SttError("fake provider dropped the connection"))
            return
        while self._line < len(self.script):
            start = self._line * self.seconds_per_line
            end = start + self.seconds_per_line
            text, speaker = self.script[self._line]
            if not self._partial_sent and elapsed >= start + self.seconds_per_line / 2:
                words = text.split()
                partial = " ".join(words[: max(1, len(words) // 2)])
                self._queue.put(
                    SttResult(partial, False, int(start * 1000), int(elapsed * 1000), speaker)
                )
                self._partial_sent = True
            if elapsed >= end:
                self._queue.put(SttResult(text, True, int(start * 1000), int(end * 1000), speaker))
                self._line += 1
                self._partial_sent = False
                continue
            break

    def results(self) -> AsyncIterator[SttResult]:
        return aiter(self._queue)

    async def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._queue.end()


class FakeSttAdapter:
    def __init__(
        self,
        name: str = "fake/stt",
        script: list[tuple[str, str | None]] | None = None,
        *,
        seconds_per_line: float = 1.0,
        fail_after_s: float | None = None,
        fail_on_open: bool = False,
        is_available: bool = True,
    ) -> None:
        self.name = name
        self.script = script or [("hello from the fake transcriber", None)]
        self.seconds_per_line = seconds_per_line
        self.fail_after_s = fail_after_s
        self.fail_on_open = fail_on_open
        self.is_available = is_available
        self.opened: list[SttOptions] = []

    def available(self) -> bool:
        return self.is_available

    async def open(self, opts: SttOptions) -> FakeSttSession:
        if self.fail_on_open:
            raise SttError(f"{self.name} refused the connection")
        self.opened.append(opts)
        return FakeSttSession(list(self.script), self.seconds_per_line, self.fail_after_s)
