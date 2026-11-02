"""Name system-channel speakers who enrolled their voice.

The transcriber's diarization labels the meeting audio "spk_0", "spk_1"... For each label we
collect its audio (from the time ranges of its final segments), embed it once there's enough,
and compare it with the enrolled voiceprints that may appear in this meeting (the owner's and
the project's members'). A match above the threshold emits speaker.identified. Each enrolled
person is matched to at most one label. Unmatched speakers stay "Speaker N".
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.providers.speaker_id import SpeakerIdRouter, cosine
from app.router.config import SpeakerIdConfig

log = logging.getLogger("app.realtime.speakers")

BYTES_PER_MS = 32
KEEP_MS = 120_000


@dataclass
class Candidate:
    speaker_id: str  # enrolled speaker row id
    user_id: str
    display_name: str
    vector: list[float]


@dataclass
class _Label:
    audio: bytearray = field(default_factory=bytearray)
    #: Stop collecting: matched, or enough unmatched audio seen.
    done: bool = False
    matched: bool = False
    tried_at_bytes: int = 0


OnMatch = Callable[[str, Candidate, float], Awaitable[None]]


class SpeakerMatcher:
    def __init__(
        self,
        cfg: SpeakerIdConfig,
        router: SpeakerIdRouter,
        candidates: list[Candidate],
        on_match: OnMatch,
    ):
        self.cfg = cfg
        self.router = router
        self.candidates = candidates
        self.on_match = on_match
        self._buf = bytearray()
        self._buf_start_ms = 0.0
        self._labels: dict[str, _Label] = {}
        self._claimed: set[str] = set()
        self._tasks: set[asyncio.Task] = set()

    @property
    def enabled(self) -> bool:
        return bool(self.candidates) and self.router.embedder() is not None

    def add_audio(self, pos_ms: float, pcm: bytes) -> None:
        """System-channel audio at channel position `pos_ms` (as fed to the transcriber)."""
        if not self.enabled:
            return
        if not self._buf:
            self._buf_start_ms = pos_ms
        self._buf += pcm
        excess = len(self._buf) - KEEP_MS * BYTES_PER_MS
        if excess > 0:
            excess -= excess % 2
            del self._buf[:excess]
            self._buf_start_ms += excess / BYTES_PER_MS

    def _slice(self, start_ms: float, end_ms: float) -> bytes:
        a = int((start_ms - self._buf_start_ms) * BYTES_PER_MS)
        b = int((end_ms - self._buf_start_ms) * BYTES_PER_MS)
        a, b = max(0, a - a % 2), max(0, min(len(self._buf), b - b % 2))
        return bytes(self._buf[a:b]) if b > a else b""

    def on_segment(self, label: str, start_ms: float, end_ms: float) -> None:
        """A final segment by `label` covering channel time start..end."""
        if not self.enabled or not label.startswith("spk_"):
            return
        st = self._labels.setdefault(label, _Label())
        if st.done:
            return
        st.audio += self._slice(start_ms, end_ms)
        have_s = len(st.audio) / (BYTES_PER_MS * 1000)
        # First try at min_audio_s, then again each time the audio grows by half that.
        step = self.cfg.min_audio_s * BYTES_PER_MS * 1000 / 2
        if have_s >= self.cfg.min_audio_s and len(st.audio) - st.tried_at_bytes >= step:
            st.tried_at_bytes = len(st.audio)
            t = asyncio.create_task(
                self._try(label, bytes(st.audio[-int(self.cfg.max_audio_s * 32_000) :]))
            )
            self._tasks.add(t)
            t.add_done_callback(self._tasks.discard)
        if have_s >= self.cfg.max_audio_s:
            st.done = True  # enough tries; leave as "Speaker N"

    async def _try(self, label: str, pcm: bytes) -> None:
        try:
            vec, _name = await self.router.embed(pcm)
        except Exception:
            log.exception("speaker embedding failed")
            return
        st = self._labels[label]
        if st.matched:
            return
        unclaimed = [c for c in self.candidates if c.speaker_id not in self._claimed]
        if not unclaimed:
            return
        score, cand = max(((cosine(vec, c.vector), c) for c in unclaimed), key=lambda x: x[0])
        log.info("speaker %s best=%s score=%.3f", label, cand.display_name, score)
        if score < self.cfg.threshold:
            return
        self._claimed.add(cand.speaker_id)
        st.matched = st.done = True
        await self.on_match(label, cand, round(score, 3))

    async def drain(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)


def speaker_plugin_factory(speakers, router: SpeakerIdRouter, cfg: SpeakerIdConfig):
    """Builds the speaker-naming plugin for a meeting, or None if nobody's voice can be matched."""
    from app.events import SpeakerIdentified
    from app.voiceprints import unseal

    from .session import Plugin

    class SpeakerPlugin(Plugin):
        def __init__(self, session, matcher: SpeakerMatcher) -> None:
            self.session = session
            self.matcher = matcher

        def on_audio(self, channel: str, pos_ms: float, pcm: bytes) -> None:
            if channel == "system":
                self.matcher.add_audio(pos_ms, pcm)

        async def on_final(self, segment, channel_start_ms: float, channel_end_ms: float) -> None:
            if segment.channel == "system":
                self.matcher.on_segment(segment.speaker_id, channel_start_ms, channel_end_ms)

        async def close(self) -> None:
            await self.matcher.drain()

    async def make(session):
        m = session.meeting
        if m.mode == "live-only" or router.embedder() is None:
            return None
        rows = await speakers.candidates(m.owner_id, m.project_id)
        candidates = []
        for r in rows:
            try:
                candidates.append(Candidate(r.id, r.user_id, r.display_name, unseal(r.voiceprint)))
            except ValueError:
                log.warning("skipping a voiceprint that can't be decrypted (key changed?)")
        if not candidates:
            return None

        async def on_match(label: str, cand: Candidate, score: float) -> None:
            await session.emit(
                SpeakerIdentified,
                speaker_id=label,
                display_name=cand.display_name,
                confidence=score,
            )
            # The name (text) is kept for the transcript and summary; no new voiceprint is made.
            await session.store.set_speaker_name(m.id, label, cand.display_name)

        return SpeakerPlugin(session, SpeakerMatcher(cfg, router, candidates, on_match))

    return make
