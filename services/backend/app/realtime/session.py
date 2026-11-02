"""A live meeting: one STT stream per channel, an event log with seq numbers, and the sockets
watching it. Survives client reconnects; the client replays from its last seq.

Audio frames: byte 0 = channel (0 mic, 1 system), then 640 bytes of 16 kHz mono PCM16.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel

from app.events import (
    Control,
    Error,
    MeetingStarted,
    ProviderSwitched,
    QuotaWarning,
    TranscriptFinal,
    TranscriptPartial,
    dump_event,
)
from app.meetings.store import Meeting, MeetingStore, Segment
from app.metrics import metrics
from app.providers.stt.base import SttError, SttOptions, SttResult
from app.router.policy import DataPolicyError
from app.router.stt import TASK as STT_TASK
from app.router.stt import OpenedStt, SttRegistry

from .timeline import Timeline, now_ms

log = logging.getLogger("app.realtime")

FRAME_BYTES = 640
WIRE_FRAME_BYTES = FRAME_BYTES + 1
CHANNELS: dict[int, Literal["mic", "system"]] = {0: "mic", 1: "system"}
#: Audio held while switching providers (10 s per channel).
SWITCH_BUFFER_BYTES = 10 * 32_000
#: How often audio seconds are written to the quota tracker.
USAGE_FLUSH_S = 10.0
RETRY_OPEN_S = 30.0
MAX_LOG = 50_000

Peer = Callable[[dict[str, Any]], None]


class ChannelWorker:
    """Feeds one channel's audio to the current STT provider and switches on failure."""

    def __init__(self, session: MeetingSession, channel: Literal["mic", "system"]) -> None:
        self.session = session
        self.channel = channel
        self.stt: OpenedStt | None = None
        # One timeline per channel for the whole meeting; each provider session starts at
        # `base_ms` on it, so a switch doesn't reset caption times to zero.
        self.timeline = Timeline(session.start_wall_ms)
        self.base_ms = 0.0
        self.failed: set[str] = set()
        self._buffer = bytearray()
        self._buffer_pos: float | None = None
        self._switching: asyncio.Task | None = None
        self._opener: asyncio.Task | None = None
        self._first_attempt = asyncio.Event()
        self._reader: asyncio.Task | None = None
        self._unrecorded_s = 0.0
        self._last_flush = now_ms()
        self._closed = False

    @property
    def provider(self) -> str | None:
        return self.stt.deployment.id if self.stt else None

    def _options(self) -> SttOptions:
        m = self.session.meeting
        return SttOptions(keyterms=tuple(m.vocabulary), diarize=self.channel == "system")

    def _exclude(self) -> set[str]:
        ex = set(self.failed)
        if self.session.meeting.mode == "local":
            # Local-only: nothing may leave this machine.
            ex |= {d.id for d in self.session.registry.chain if d.provider != "local"}
        return ex

    async def start(self, wait_s: float = 15.0) -> None:
        """Open the first provider. If none is available, keep retrying in the background."""
        self._opener = asyncio.create_task(self._open(reason=None))
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._first_attempt.wait(), wait_s)

    async def _open(self, reason: str | None) -> None:
        previous = self.stt.deployment.id if self.stt else None
        while not self._closed:
            try:
                opened = await self.session.registry.open(
                    "meeting", self._options(), exclude=self._exclude()
                )
            except (SttError, DataPolicyError) as e:
                # Kept for replay so a client that connects later still sees why.
                await self.session.emit(
                    Error, code="stt_unavailable", message=f"{self.channel}: {e}", retryable=True
                )
                self._first_attempt.set()
                await asyncio.sleep(RETRY_OPEN_S)
                continue
            self._first_attempt.set()
            self.stt = opened
            self.base_ms = (
                self._buffer_pos if self._buffer_pos is not None else self.timeline.audio_ms
            )
            self._reader = asyncio.create_task(self._read(opened))
            if previous and previous != opened.deployment.id:
                await self.session.emit(
                    ProviderSwitched,
                    task=STT_TASK,
                    from_=previous,
                    to=opened.deployment.id,
                    reason=f"{self.channel}: {reason}" if reason else self.channel,
                )
            # Audio that arrived while switching goes first.
            if self._buffer:
                pending = bytes(self._buffer)
                self._buffer.clear()
                self._buffer_pos = None
                await self._send(pending)
            return

    async def feed(self, pcm: bytes) -> None:
        if self._closed:
            return
        pos = self.timeline.audio_ms
        self.timeline.on_audio(len(pcm))
        for plugin in self.session.plugins:
            plugin.on_audio(self.channel, pos, pcm)
        if self.stt is None or (self._switching and not self._switching.done()):
            if self._buffer_pos is None:
                self._buffer_pos = pos
            self._buffer += pcm
            if len(self._buffer) > SWITCH_BUFFER_BYTES:
                dropped = len(self._buffer) - SWITCH_BUFFER_BYTES
                del self._buffer[:dropped]
                self._buffer_pos += dropped / 32
            return
        await self._send(pcm)

    async def _send(self, pcm: bytes) -> None:
        assert self.stt
        try:
            await self.stt.session.send(pcm)
        except SttError as e:
            self._fail(str(e))
            return
        self._unrecorded_s += len(pcm) / 32_000
        if now_ms() - self._last_flush >= USAGE_FLUSH_S * 1000:
            await self._flush_usage()

    async def _flush_usage(self) -> None:
        self._last_flush = now_ms()
        if not self.stt or self._unrecorded_s <= 0:
            return
        seconds, self._unrecorded_s = self._unrecorded_s, 0.0
        warn = await self.session.registry.record_audio(self.stt.deployment, seconds)
        if warn is not None:
            await self.session.emit(
                QuotaWarning,
                provider=self.stt.deployment.provider,
                task=STT_TASK,
                percent_used=round(warn * 100, 1),
                store=False,
            )

    def _fail(self, reason: str) -> None:
        if self._closed or (self._switching and not self._switching.done()) or not self.stt:
            return
        log.warning("stt %s failed on %s: %s", self.channel, self.stt.deployment.id, reason)
        self.failed.add(self.stt.deployment.id)
        self.session.registry.failed(self.stt.deployment)
        self._switching = asyncio.create_task(self._switch(reason))

    async def _switch(self, reason: str) -> None:
        t0 = now_ms()
        await self._flush_usage()
        old = self.stt
        if old:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(old.session.close(), 2)
        await self._open(reason)
        metrics.record("stt.switch_ms", now_ms() - t0, self.provider)

    async def _read(self, opened: OpenedStt) -> None:
        try:
            async for r in opened.session.results():
                await self._emit_result(r, opened)
        except SttError as e:
            if self.stt is opened:
                self._fail(str(e))
        except Exception as e:  # never let a provider bug kill the meeting
            log.exception("stt reader crashed")
            if self.stt is opened:
                self._fail(f"{type(e).__name__}: {e}")

    async def _emit_result(self, r: SttResult, opened: OpenedStt) -> None:
        if self.stt is not opened:
            return
        tl, base = self.timeline, self.base_ms
        speaker = "me" if self.channel == "mic" else f"spk_{r.speaker or '0'}"
        start, end = tl.meeting_ms(base + r.start_ms), tl.meeting_ms(base + r.end_ms)
        latency = now_ms() - tl.wall_at(base + r.end_ms)
        provider = opened.deployment.id
        if r.is_final:
            metrics.record("stt.final_ms", latency, provider)
            seg_id = self.session.next_segment_id()
            await self.session.emit(
                TranscriptFinal,
                segment_id=seg_id,
                channel=self.channel,
                speaker_id=speaker,
                text=r.text,
                start_ms=start,
                end_ms=max(start, end),
            )
            segment = Segment(
                self.session.meeting.id,
                seg_id,
                self.channel,
                speaker,
                r.text,
                start,
                max(start, end),
                provider,
            )
            await self.session.save_segment(segment)
            await self.session.after_final(segment, base + r.start_ms, base + r.end_ms)
        else:
            metrics.record("stt.partial_ms", latency, provider)
            await self.session.emit(
                TranscriptPartial,
                channel=self.channel,
                speaker_id=speaker,
                text=r.text,
                start_ms=start,
                store=False,
            )

    async def close(self) -> None:
        """Flush: let the provider send its last finals, then stop."""
        if self._switching and not self._switching.done():
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._switching, 5)
        self._closed = True
        if self._opener and not self._opener.done():
            self._opener.cancel()
        await self._flush_usage()
        if self.stt:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self.stt.session.close(), 10)
        if self._reader:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._reader, 5)


class Plugin:
    """A live feature attached to a meeting (speaker naming, live help...). Override what you need."""

    async def start(self) -> None: ...

    def on_audio(self, channel: str, pos_ms: float, pcm: bytes) -> None: ...

    async def on_final(
        self, segment: Segment, channel_start_ms: float, channel_end_ms: float
    ) -> None: ...

    async def on_control(self, msg: Control, peer: Peer) -> bool:
        """Return True if handled."""
        return False

    async def close(self) -> None: ...


PluginFactory = Callable[["MeetingSession"], Awaitable[Plugin | None]]


class MeetingSession:
    def __init__(
        self,
        meeting: Meeting,
        registry: SttRegistry,
        store: MeetingStore,
        plugin_factories: list[PluginFactory] | None = None,
    ) -> None:
        self.meeting = meeting
        self.registry = registry
        self.store = store
        self.start_wall_ms = meeting.started_at * 1000
        self.paused = False
        self.ended = False
        self._seq = itertools.count(1)
        self._segments = itertools.count(1)
        self._log: list[dict[str, Any]] = []
        self._peers: list[Peer] = []
        self._lock = asyncio.Lock()
        self.workers = {"mic": ChannelWorker(self, "mic"), "system": ChannelWorker(self, "system")}
        self._started = False
        self._plugin_factories = plugin_factories or []
        self.plugins: list[Plugin] = []
        #: Recent final segments (both channels), for live help.
        self.recent: list[Segment] = []

    def next_segment_id(self) -> str:
        return f"seg_{next(self._segments)}"

    async def start(self) -> None:
        if self._started:
            return
        self._started = True
        for make in self._plugin_factories:
            try:
                plugin = await make(self)
            except Exception:
                log.exception("plugin failed to start")
                continue
            if plugin is not None:
                await plugin.start()
                self.plugins.append(plugin)
        # Start both channels' STT without blocking on a slow or missing provider.
        await asyncio.gather(*(w.start() for w in self.workers.values()), return_exceptions=True)
        providers = {
            f"{STT_TASK}.{name}": w.provider for name, w in self.workers.items() if w.provider
        }
        await self.emit(MeetingStarted, mode=self.meeting.mode, providers=providers)

    async def emit(
        self, cls: type[BaseModel], *, store: bool = True, only: Peer | None = None, **fields: Any
    ) -> dict[str, Any]:
        """Build an event with the next seq, keep it for replay (unless store=False), send it."""
        async with self._lock:
            event = cls(
                seq=next(self._seq), meeting_id=self.meeting.id, ts_ms=int(now_ms()), **fields
            )
            data = dump_event(event)  # type: ignore[arg-type]
            if store:
                self._log.append(data)
                if len(self._log) > MAX_LOG:
                    del self._log[: len(self._log) - MAX_LOG]
            for peer in [only] if only else list(self._peers):
                peer(data)
            return data

    async def attach(self, peer: Peer, last_seq: int = 0) -> int:
        """Replay everything after `last_seq`, then stream live. Returns how many were replayed."""
        async with self._lock:
            missed = [e for e in self._log if e["seq"] > last_seq]
            for e in missed:
                peer(e)
            self._peers.append(peer)
            return len(missed)

    def detach(self, peer: Peer) -> None:
        with contextlib.suppress(ValueError):
            self._peers.remove(peer)

    @property
    def watchers(self) -> int:
        return len(self._peers)

    async def on_audio(self, data: bytes) -> None:
        if len(data) == 0 or len(data) % WIRE_FRAME_BYTES:
            raise ValueError(
                f"audio messages must be whole {WIRE_FRAME_BYTES}-byte frames, got {len(data)} bytes"
            )
        if self.paused or self.ended:
            return
        # A message may carry several frames (e.g. a replayed backlog); group by channel.
        by_channel: dict[str, bytearray] = {}
        for i in range(0, len(data), WIRE_FRAME_BYTES):
            ch = CHANNELS.get(data[i])
            if ch is None:
                raise ValueError(f"unknown audio channel {data[i]}")
            by_channel.setdefault(ch, bytearray()).extend(data[i + 1 : i + WIRE_FRAME_BYTES])
        for ch, pcm in by_channel.items():
            await self.workers[ch].feed(bytes(pcm))

    async def on_control(self, msg: Control, peer: Peer) -> None:
        if msg.action == "pause":
            self.paused = True
        elif msg.action == "resume":
            self.paused = False
        else:
            for plugin in self.plugins:
                if await plugin.on_control(msg, peer):
                    return
            # catch_up, clarify, follow_up and card_feedback need live help (Prompts 10-11).
            await self.emit(
                Error,
                code="not_implemented",
                message=f"{msg.action} isn't available yet",
                retryable=False,
                store=False,
                only=peer,
            )

    async def save_segment(self, segment: Segment) -> None:
        if self.meeting.mode == "live-only":
            return  # Live-only: help during the call, nothing saved.
        await self.store.add_segment(segment)

    async def after_final(
        self, segment: Segment, channel_start_ms: float, channel_end_ms: float
    ) -> None:
        self.recent.append(segment)
        if len(self.recent) > 500:
            del self.recent[:100]
        for plugin in self.plugins:
            try:
                await plugin.on_final(segment, channel_start_ms, channel_end_ms)
            except Exception:
                log.exception("plugin failed on a final segment")

    async def end(self) -> None:
        if self.ended:
            return
        self.ended = True
        await asyncio.gather(*(w.close() for w in self.workers.values()), return_exceptions=True)
        await asyncio.gather(*(p.close() for p in self.plugins), return_exceptions=True)
