"""Integrations: calendars, Jira and chat webhooks, each behind a small interface with a Fake.

Feature code talks to these interfaces only; the real adapters live next to them."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Literal, Protocol

Kind = Literal["google", "microsoft", "jira", "slack", "teams"]
KINDS: tuple[Kind, ...] = ("google", "microsoft", "jira", "slack", "teams")
CALENDARS: tuple[Kind, ...] = ("google", "microsoft")
POSTERS: tuple[Kind, ...] = ("slack", "teams")


class IntegrationError(RuntimeError):
    def __init__(self, message: str, *, reconnect: bool = False) -> None:
        super().__init__(message)
        #: The stored credentials no longer work; the user must connect again.
        self.reconnect = reconnect


@dataclass
class CalendarEvent:
    id: str
    source: Kind
    title: str
    start: float  # unix seconds
    end: float
    attendees: int = 0
    description: str = ""
    join_url: str | None = None


@dataclass
class Ticket:
    key: str
    summary: str
    status: str
    updated: float
    url: str | None = None


class Calendar(Protocol):
    async def upcoming(self, creds: dict, start: float, end: float) -> list[CalendarEvent]: ...


class Tickets(Protocol):
    async def updated_since(self, creds: dict, since: float) -> list[Ticket]: ...


class Poster(Protocol):
    async def post(self, creds: dict, text: str) -> None: ...


# ---------- guessing the meeting type from a calendar event ----------

TYPE_WORDS: list[tuple[str, str]] = [
    ("standup", r"\b(stand[- ]?up|daily|scrum|sync-?up)\b"),
    ("incident", r"\b(incident|outage|war ?room|sev ?[0-3]|postmortem|post-mortem|rca)\b"),
    ("review", r"\b(review|demo|retro(spective)?|walkthrough|code review|design review)\b"),
    ("planning", r"\b(planning|refinement|grooming|backlog|roadmap|kick-?off)\b"),
    ("one_on_one", r"\b(1[:-]1|one[- ]on[- ]one|1on1|catch[- ]up)\b"),
    ("client", r"\b(client|customer|vendor|sales|partner|stakeholder|board)\b"),
    ("research", r"\b(training|workshop|learning|lunch ?(and|&) ?learn|brown ?bag|research)\b"),
]


def guess_type(title: str, attendees: int = 0) -> str:
    t = title.lower()
    for kind, pattern in TYPE_WORDS:
        if re.search(pattern, t):
            return kind
    if attendees == 2:
        return "one_on_one"
    return "custom"


# ---------- Fakes (tests, CI, COPILOT_FAKE_PROVIDERS=1) ----------


@dataclass
class FakeCalendar:
    """Two events relative to now: a standup starting in 90 s and a review in two hours."""

    events: list[CalendarEvent] | None = None
    calls: list[tuple[float, float]] = field(default_factory=list)

    async def upcoming(self, creds: dict, start: float, end: float) -> list[CalendarEvent]:
        self.calls.append((start, end))
        now = time.time()
        events = self.events or [
            CalendarEvent(
                "fake-standup",
                "google",
                "Payments daily standup",
                now + 90,
                now + 990,
                6,
                "1. Deploy plan\n2. Blockers",
            ),
            CalendarEvent(
                "fake-review", "google", "Retry PR design review", now + 7200, now + 9000, 4
            ),
        ]
        return [e for e in events if e.end >= start and e.start <= end]


@dataclass
class FakeTickets:
    tickets: list[Ticket] | None = None

    async def updated_since(self, creds: dict, since: float) -> list[Ticket]:
        now = time.time()
        items = self.tickets or [
            Ticket("OPS-142", "Renew the payments cluster certificate", "Done", now - 3600),
            Ticket("OPS-150", "Move the prod deploy to Thursday", "In Progress", now - 1800),
        ]
        return [t for t in items if t.updated >= since]


@dataclass
class FakePoster:
    posts: list[tuple[str, str]] = field(default_factory=list)

    async def post(self, creds: dict, text: str) -> None:
        self.posts.append((creds.get("webhook_url", ""), text))
