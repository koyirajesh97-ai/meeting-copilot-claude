"""Meetings and their final transcript segments. In memory for now; Postgres arrives with the
database (Prompt 6) behind the same interface."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Literal, Protocol

MeetingType = Literal[
    "standup", "review", "planning", "incident", "client", "one_on_one", "research", "custom"
]
MeetingMode = Literal["cloud", "local", "live-only"]
Visibility = Literal["private", "project"]
ChannelName = Literal["mic", "system"]


@dataclass
class Meeting:
    id: str
    owner_id: str
    type: MeetingType
    title: str
    mode: MeetingMode
    visibility: Visibility
    project_id: str | None = None
    started_at: float = field(default_factory=time.time)
    ended_at: float | None = None
    #: Project vocabulary for this meeting (key terms for transcription).
    vocabulary: list[str] = field(default_factory=list)
    agenda: str = ""


@dataclass
class Segment:
    meeting_id: str
    segment_id: str
    channel: ChannelName
    speaker_id: str
    text: str
    start_ms: int
    end_ms: int
    provider: str


SummaryStatus = Literal["none", "pending", "ready", "failed"]


@dataclass
class StoredSummary:
    id: str
    meeting_id: str
    template: str
    #: The validated Summary (app.summaries.schema) as JSON-ready data.
    sections: dict
    model: str
    created_at: float = field(default_factory=time.time)


@dataclass
class ActionItemRecord:
    id: str
    meeting_id: str | None
    text: str
    owner: str | None = None
    due_text: str | None = None
    status: Literal["open", "done", "dropped"] = "open"
    source: Literal["summary", "manual", "follow_up"] = "manual"
    created_at: float = field(default_factory=time.time)
    #: Follow-ups: the question that couldn't be answered live, who asked, and the drafted reply.
    question: str | None = None
    asker: str | None = None
    draft: str | None = None


ConsentKind = Literal["announced", "objection", "paused", "resumed"]


@dataclass
class ConsentEvent:
    meeting_id: str
    kind: ConsentKind
    note: str | None = None
    at: float = field(default_factory=time.time)


@dataclass
class DecisionRecord:
    id: str
    meeting_id: str | None
    text: str
    rationale: str = ""
    source: Literal["summary", "manual"] = "manual"


class MeetingStore(Protocol):
    async def upsert_user(
        self, user_id: str, email: str | None, *, ensure_auth_user: bool = False
    ) -> None: ...
    async def create(self, meeting: Meeting) -> Meeting: ...
    async def get(self, meeting_id: str) -> Meeting | None: ...
    async def list_for(self, owner_id: str, limit: int = 100) -> list[Meeting]: ...
    async def end(self, meeting_id: str) -> Meeting | None: ...
    async def add_segment(self, segment: Segment) -> None: ...
    async def segments(self, meeting_id: str) -> list[Segment]: ...
    # summaries
    async def set_summary_status(
        self, meeting_id: str, status: SummaryStatus, error: str | None = None
    ) -> None: ...
    async def summary_status(self, meeting_id: str) -> tuple[SummaryStatus, str | None]: ...
    async def save_summary(self, s: StoredSummary) -> StoredSummary: ...
    async def latest_summary(self, meeting_id: str) -> StoredSummary | None: ...
    async def update_summary(self, summary_id: str, sections: dict) -> None: ...
    async def replace_summary_items(
        self, meeting: Meeting, items: list[ActionItemRecord], decisions: list[DecisionRecord]
    ) -> None: ...
    async def add_action_item(
        self, meeting: Meeting, item: ActionItemRecord
    ) -> ActionItemRecord: ...
    async def action_items(self, meeting_id: str) -> list[ActionItemRecord]: ...
    async def set_draft(self, item_id: str, draft: str) -> None: ...
    async def open_action_items(
        self, user_id: str, limit: int = 20
    ) -> list[tuple[ActionItemRecord, Meeting]]: ...
    async def previous_in_series(
        self, owner_id: str, meeting_type: str, series: str, before: float, exclude_id: str | None
    ) -> Meeting | None: ...
    # projects
    async def detach_project(self, project_id: str) -> None: ...
    async def list_shared(
        self, project_ids: list[str], exclude_owner: str, limit: int = 100
    ) -> list[Meeting]: ...
    async def update_meeting(self, m: Meeting) -> Meeting: ...
    async def project_action_items(
        self, project_id: str
    ) -> list[tuple[ActionItemRecord, Meeting]]: ...
    async def get_action_item(self, item_id: str) -> tuple[ActionItemRecord, Meeting] | None: ...
    async def update_action_item(
        self, item_id: str, *, status: str | None, owner: str | None, due_text: str | None
    ) -> None: ...
    async def decisions(self, meeting_id: str) -> list[DecisionRecord]: ...
    # privacy
    async def add_consent_event(self, e: ConsentEvent) -> None: ...
    async def consent_events(self, meeting_id: str) -> list[ConsentEvent]: ...
    async def delete_meeting(self, meeting_id: str) -> None: ...
    async def expired_meetings(self, now: float) -> list[Meeting]: ...
    # speaker names given in a meeting (text only; never a voiceprint)
    async def set_speaker_name(self, meeting_id: str, label: str, name: str) -> None: ...
    async def speaker_names(self, meeting_id: str) -> dict[str, str]: ...


#: A Live-only meeting whose app never came back to end it is deleted after this long.
LIVE_ONLY_MAX_S = 12 * 3600


def series_key(title: str) -> str:
    """Meetings with the same title apart from dates and numbers are one series ("Standup 3/4")."""
    import re

    t = re.sub(r"\b\d{1,4}([/.-]\d{1,4}){0,2}\b", " ", title.lower())
    t = re.sub(r"\b(mon|tues|wednes|thurs|fri|satur|sun)day\b", " ", t)
    return " ".join(re.findall(r"[a-z]+", t))


def new_id() -> str:
    return str(uuid.uuid4())


def new_meeting_id() -> str:
    return str(uuid.uuid4())


class InMemoryMeetingStore:
    def __init__(self) -> None:
        self._meetings: dict[str, Meeting] = {}
        self._segments: dict[str, list[Segment]] = {}
        self._summary_status: dict[str, tuple[SummaryStatus, str | None]] = {}
        self._summaries: dict[str, list[StoredSummary]] = {}
        self._items: dict[str, list[ActionItemRecord]] = {}
        self._decisions: dict[str, list[DecisionRecord]] = {}
        self._names: dict[str, dict[str, str]] = {}
        self._consent: dict[str, list[ConsentEvent]] = {}
        #: owner_id -> retention days (in Postgres: users.retention_days).
        self.retention: dict[str, int] = {}

    async def upsert_user(
        self, user_id: str, email: str | None, *, ensure_auth_user: bool = False
    ) -> None:
        return None

    async def list_for(self, owner_id: str, limit: int = 100) -> list[Meeting]:
        mine = [m for m in self._meetings.values() if m.owner_id == owner_id]
        return sorted(mine, key=lambda m: m.started_at, reverse=True)[:limit]

    async def create(self, meeting: Meeting) -> Meeting:
        self._meetings[meeting.id] = meeting
        self._segments[meeting.id] = []
        return meeting

    async def get(self, meeting_id: str) -> Meeting | None:
        return self._meetings.get(meeting_id)

    async def end(self, meeting_id: str) -> Meeting | None:
        m = self._meetings.get(meeting_id)
        if m and m.ended_at is None:
            m.ended_at = time.time()
        return m

    async def add_segment(self, segment: Segment) -> None:
        self._segments.setdefault(segment.meeting_id, []).append(segment)

    async def segments(self, meeting_id: str) -> list[Segment]:
        return sorted(self._segments.get(meeting_id, []), key=lambda s: (s.start_ms, s.segment_id))

    async def set_summary_status(
        self, meeting_id: str, status: SummaryStatus, error: str | None = None
    ) -> None:
        self._summary_status[meeting_id] = (status, error)

    async def summary_status(self, meeting_id: str) -> tuple[SummaryStatus, str | None]:
        return self._summary_status.get(meeting_id, ("none", None))

    async def save_summary(self, s: StoredSummary) -> StoredSummary:
        self._summaries.setdefault(s.meeting_id, []).append(s)
        return s

    async def latest_summary(self, meeting_id: str) -> StoredSummary | None:
        found = self._summaries.get(meeting_id)
        return found[-1] if found else None

    async def update_summary(self, summary_id: str, sections: dict) -> None:
        for lst in self._summaries.values():
            for s in lst:
                if s.id == summary_id:
                    s.sections = sections

    async def replace_summary_items(
        self, meeting: Meeting, items: list[ActionItemRecord], decisions: list[DecisionRecord]
    ) -> None:
        mid = meeting.id
        self._items[mid] = [i for i in self._items.get(mid, []) if i.source != "summary"] + items
        self._decisions[mid] = [
            d for d in self._decisions.get(mid, []) if d.source != "summary"
        ] + decisions

    async def add_action_item(self, meeting: Meeting, item: ActionItemRecord) -> ActionItemRecord:
        self._items.setdefault(meeting.id, []).append(item)
        return item

    async def action_items(self, meeting_id: str) -> list[ActionItemRecord]:
        return list(self._items.get(meeting_id, []))

    async def decisions(self, meeting_id: str) -> list[DecisionRecord]:
        return list(self._decisions.get(meeting_id, []))

    async def set_speaker_name(self, meeting_id: str, label: str, name: str) -> None:
        self._names.setdefault(meeting_id, {})[label] = name

    async def speaker_names(self, meeting_id: str) -> dict[str, str]:
        return dict(self._names.get(meeting_id, {}))

    async def set_draft(self, item_id: str, draft: str) -> None:
        for items in self._items.values():
            for i in items:
                if i.id == item_id:
                    i.draft = draft

    async def open_action_items(
        self, user_id: str, limit: int = 20
    ) -> list[tuple[ActionItemRecord, Meeting]]:
        out = []
        for mid, items in self._items.items():
            m = self._meetings.get(mid)
            if m and m.owner_id == user_id:
                out += [(i, m) for i in items if i.status == "open"]
        return sorted(out, key=lambda x: -x[0].created_at)[:limit]

    async def previous_in_series(
        self, owner_id: str, meeting_type: str, series: str, before: float, exclude_id: str | None
    ) -> Meeting | None:
        cands = [
            m
            for m in self._meetings.values()
            if m.owner_id == owner_id
            and m.type == meeting_type
            and m.id != exclude_id
            and m.started_at < before
            and series_key(m.title) == series
        ]
        return max(cands, key=lambda m: m.started_at, default=None)

    async def list_shared(
        self, project_ids: list[str], exclude_owner: str, limit: int = 100
    ) -> list[Meeting]:
        shared = [
            m
            for m in self._meetings.values()
            if m.visibility == "project"
            and m.project_id in project_ids
            and m.owner_id != exclude_owner
        ]
        return sorted(shared, key=lambda m: m.started_at, reverse=True)[:limit]

    async def update_meeting(self, m: Meeting) -> Meeting:
        self._meetings[m.id] = m
        return m

    async def project_action_items(self, project_id: str) -> list[tuple[ActionItemRecord, Meeting]]:
        out = []
        for mid, items in self._items.items():
            m = self._meetings.get(mid)
            if m and m.project_id == project_id and m.visibility == "project":
                out += [(i, m) for i in items]
        return sorted(out, key=lambda x: x[0].created_at)

    async def get_action_item(self, item_id: str) -> tuple[ActionItemRecord, Meeting] | None:
        for mid, items in self._items.items():
            for i in items:
                if i.id == item_id and mid in self._meetings:
                    return i, self._meetings[mid]
        return None

    async def update_action_item(
        self, item_id: str, *, status: str | None, owner: str | None, due_text: str | None
    ) -> None:
        found = await self.get_action_item(item_id)
        if found:
            i = found[0]
            if status is not None:
                i.status = status  # type: ignore[assignment]
            if owner is not None:
                i.owner = owner or None
            if due_text is not None:
                i.due_text = due_text or None

    async def detach_project(self, project_id: str) -> None:
        """The project is being deleted: its meetings stay with their owners, as private."""
        for m in self._meetings.values():
            if m.project_id == project_id:
                m.project_id, m.visibility = None, "private"

    async def add_consent_event(self, e: ConsentEvent) -> None:
        self._consent.setdefault(e.meeting_id, []).append(e)

    async def consent_events(self, meeting_id: str) -> list[ConsentEvent]:
        return list(self._consent.get(meeting_id, []))

    async def delete_meeting(self, meeting_id: str) -> None:
        """Everything for a meeting: transcript, summaries, action items, decisions, names, consent."""
        for d in (
            self._meetings,
            self._segments,
            self._summary_status,
            self._summaries,
            self._items,
            self._decisions,
            self._names,
            self._consent,
        ):
            d.pop(meeting_id, None)

    async def expired_meetings(self, now: float) -> list[Meeting]:
        """Meetings past their owner's retention period, and Live-only meetings left open > 12 h."""
        out = []
        for m in self._meetings.values():
            days = self.retention.get(m.owner_id)
            if (days and m.started_at < now - days * 86400) or (
                m.mode == "live-only" and m.started_at < now - LIVE_ONLY_MAX_S
            ):
                out.append(m)
        return out
