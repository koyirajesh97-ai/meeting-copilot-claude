"""What the app does with integrations: upcoming meetings, ticket updates and posting summaries.

Adapters are built by `factory(kind)`; with COPILOT_FAKE_PROVIDERS=1 (and in tests) they are the
Fakes, so nothing here touches the network in CI."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

from .base import CALENDARS, CalendarEvent, IntegrationError, Kind, Ticket, guess_type
from .store import Integration

log = logging.getLogger("app.integrations")


def real_factory(transport=None) -> Callable[[Kind], object]:
    from .calendars import GoogleCalendar, MicrosoftCalendar
    from .jira import JiraCloud
    from .webhooks import WebhookPoster

    def make(kind: Kind):
        return {
            "google": lambda: GoogleCalendar(transport),
            "microsoft": lambda: MicrosoftCalendar(transport),
            "jira": lambda: JiraCloud(transport),
            "slack": lambda: WebhookPoster("slack", transport),
            "teams": lambda: WebhookPoster("teams", transport),
        }[kind]()

    return make


def fake_factory() -> Callable[[Kind], object]:
    from .base import FakeCalendar, FakePoster, FakeTickets

    shared = {
        "google": FakeCalendar(),
        "microsoft": FakeCalendar(events=[]),
        "jira": FakeTickets(),
        "slack": FakePoster(),
        "teams": FakePoster(),
    }
    return lambda kind: shared[kind]


@dataclass
class Upcoming:
    event: CalendarEvent
    guessed_type: str
    meeting_id: str | None = None


class IntegrationService:
    def __init__(self, store, factory: Callable[[Kind], object], fake: bool = False) -> None:
        self.store = store
        self.factory = factory
        #: Fake mode: calendars "connect" without OAuth (local dev and the e2e test).
        self.fake = fake
        self._cache: dict[str, tuple[float, list[CalendarEvent]]] = {}

    async def _enabled(self, user_id: str, kind: Kind) -> Integration | None:
        i = await self.store.get(user_id, kind)
        return i if i and i.enabled and (i.secret or self.fake) else None

    async def _failed(self, i: Integration, err: Exception) -> None:
        i.last_error = str(err)[:300]
        if isinstance(err, IntegrationError) and err.reconnect:
            i.secret = {}
        await self.store.put(i)

    async def upcoming(
        self, user_id: str, hours: float = 12, *, cache_s: float = 60
    ) -> list[CalendarEvent]:
        """Events from every enabled calendar, soonest first (cached a minute per user)."""
        hit = self._cache.get(user_id)
        if hit and time.time() - hit[0] < cache_s:
            return hit[1]
        now = time.time()

        async def one(kind: Kind) -> list[CalendarEvent]:
            i = await self._enabled(user_id, kind)
            if not i:
                return []
            adapter = self.factory(kind)
            try:
                events = await adapter.upcoming(i.secret, now - 600, now + hours * 3600)
            except Exception as e:  # one broken calendar never hides the other
                log.warning("calendar %s failed for %s: %s", kind, user_id, e)
                await self._failed(i, e)
                return []
            updated = getattr(adapter, "updated_creds", None)
            if updated or i.last_error:
                i.secret, i.last_error = updated or i.secret, None
                await self.store.put(i)
            return events

        events = sorted(
            (e for lst in await asyncio.gather(*(one(k) for k in CALENDARS)) for e in lst),
            key=lambda e: e.start,
        )
        self._cache[user_id] = (time.time(), events)
        return events

    def forget(self, user_id: str) -> None:
        self._cache.pop(user_id, None)

    async def event(self, user_id: str, event_id: str) -> CalendarEvent | None:
        return next((e for e in await self.upcoming(user_id, hours=24) if e.id == event_id), None)

    @staticmethod
    def guess(e: CalendarEvent) -> str:
        return guess_type(e.title, e.attendees)

    async def tickets_since(self, user_id: str, since: float) -> list[Ticket]:
        i = await self._enabled(user_id, "jira")
        if not i:
            return []
        try:
            return await self.factory("jira").updated_since({**i.config, **i.secret}, since)
        except Exception as e:
            log.warning("jira failed for %s: %s", user_id, e)
            await self._failed(i, e)
            return []

    async def post(self, user_id: str, kind: Kind, text: str) -> None:
        i = await self._enabled(user_id, kind)
        if not i:
            raise IntegrationError(f"{kind.title()} isn't set up; add its webhook URL in Settings.")
        await self.factory(kind).post(i.secret, text)
