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


class MeetingStore(Protocol):
    async def create(self, meeting: Meeting) -> Meeting: ...
    async def get(self, meeting_id: str) -> Meeting | None: ...
    async def end(self, meeting_id: str) -> Meeting | None: ...
    async def add_segment(self, segment: Segment) -> None: ...
    async def segments(self, meeting_id: str) -> list[Segment]: ...


def new_meeting_id() -> str:
    return str(uuid.uuid4())


class InMemoryMeetingStore:
    def __init__(self) -> None:
        self._meetings: dict[str, Meeting] = {}
        self._segments: dict[str, list[Segment]] = {}

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
