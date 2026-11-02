"""Keeps one MeetingSession per live meeting and closes idle ones."""

from __future__ import annotations

import asyncio
import contextlib
import logging

from app.meetings.store import Meeting, MeetingStore
from app.router.stt import SttRegistry

from .session import MeetingSession

log = logging.getLogger("app.realtime")

#: A meeting with no connected client for this long is closed (its STT streams flushed).
IDLE_CLOSE_S = 10 * 60


class SessionManager:
    def __init__(
        self, registry: SttRegistry, store: MeetingStore, idle_close_s: float = IDLE_CLOSE_S
    ) -> None:
        self.registry = registry
        self.store = store
        self.idle_close_s = idle_close_s
        self._sessions: dict[str, MeetingSession] = {}
        self._reapers: dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    def get(self, meeting_id: str) -> MeetingSession | None:
        return self._sessions.get(meeting_id)

    async def open(self, meeting: Meeting) -> MeetingSession:
        async with self._lock:
            s = self._sessions.get(meeting.id)
            if s is None:
                s = MeetingSession(meeting, self.registry, self.store)
                self._sessions[meeting.id] = s
        self._cancel_reaper(meeting.id)
        await s.start()
        return s

    def released(self, meeting_id: str) -> None:
        """A client disconnected; close the session if nobody comes back."""
        s = self._sessions.get(meeting_id)
        if s and s.watchers == 0 and meeting_id not in self._reapers:
            self._reapers[meeting_id] = asyncio.create_task(self._reap(meeting_id))

    def _cancel_reaper(self, meeting_id: str) -> None:
        t = self._reapers.pop(meeting_id, None)
        if t:
            t.cancel()

    async def _reap(self, meeting_id: str) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.sleep(self.idle_close_s)
            s = self._sessions.get(meeting_id)
            if s and s.watchers == 0:
                log.info("closing idle meeting %s", meeting_id)
                await self.end(meeting_id, mark_ended=False)
        self._reapers.pop(meeting_id, None)

    async def end(self, meeting_id: str, *, mark_ended: bool = True) -> None:
        self._cancel_reaper(meeting_id)
        s = self._sessions.pop(meeting_id, None)
        if s:
            await s.end()
        if mark_ended:
            await self.store.end(meeting_id)

    async def shutdown(self) -> None:
        for mid in list(self._sessions):
            await self.end(mid, mark_ended=False)
