"""Standup prep (rough notes -> done / doing / blockers + a 30-second script) and the
pre-meeting brief (your open action items, the last decisions and blockers of this series,
the agenda)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from pydantic import BaseModel

from app.meetings.store import MeetingStore, series_key
from app.profiles.store import RoleProfile
from app.prompts import load
from app.router.router import Router
from app.summaries.schema import Summary

from .store import StandupEntry


class StandupOut(BaseModel):
    done: list[str] = []
    doing: list[str] = []
    blockers: list[str] = []
    script: str = ""


def today() -> date:
    return datetime.now(UTC).date()


def _entry_text(e: StandupEntry | None) -> str:
    if e is None:
        return "none"
    return f"done: {'; '.join(e.done) or '-'}; doing: {'; '.join(e.doing) or '-'}; blockers: {'; '.join(e.blockers) or '-'}"


class StandupService:
    def __init__(self, store, meetings: MeetingStore, router: Router, profiles) -> None:
        self.store = store
        self.meetings = meetings
        self.router = router
        self.profiles = profiles

    async def generate(self, user_id: str, notes: str, project_id: str | None) -> StandupEntry:
        profile = await self.profiles.get(user_id) or RoleProfile()
        day = today()
        previous = await self.store.previous(user_id, project_id, day)
        items = await self.meetings.open_action_items(user_id, 10)
        out = await self.router.complete(
            "standup",
            load("standup_script").render(
                name=profile.name or "me",
                role_title=profile.title or "team member",
                speaking_style=profile.speaking_style or "brief",
                notes=notes,
                previous_entry=_entry_text(previous),
                action_items="; ".join(i.text for i, _m in items) or "none",
            ),
            "meeting",
            StandupOut,
            owner_id=user_id,
        )
        s: StandupOut = out.json
        return await self.store.upsert(
            StandupEntry(user_id, project_id, day, notes, s.done, s.doing, s.blockers, s.script)
        )

    async def notes_for(self, user_id: str, project_id: str | None) -> str:
        """Today's standup notes, for answer cards ("what are you working on?")."""
        e = await self.store.get(user_id, project_id, today()) or (
            await self.store.get(user_id, None, today()) if project_id else None
        )
        if e is None:
            return ""
        return f"{e.notes} | {_entry_text(e)}".strip(" |")

    async def script_for(self, user_id: str, project_id: str | None) -> StandupEntry | None:
        e = await self.store.get(user_id, project_id, today())
        if e is None and project_id:
            e = await self.store.get(user_id, None, today())
        return e if e and e.script else None


@dataclass
class Brief:
    open_action_items: list[dict] = field(default_factory=list)
    last_meeting: dict | None = None
    last_decisions: list[str] = field(default_factory=list)
    last_blockers: list[str] = field(default_factory=list)
    last_open_questions: list[str] = field(default_factory=list)
    agenda: str = ""


async def build_brief(
    meetings: MeetingStore,
    user_id: str,
    title: str,
    meeting_type: str,
    agenda: str = "",
    exclude_id: str | None = None,
    before: float | None = None,
) -> Brief:
    b = Brief(agenda=agenda)
    for item, m in await meetings.open_action_items(user_id, 20):
        b.open_action_items.append(
            {
                "id": item.id,
                "text": item.text,
                "owner": item.owner,
                "due": item.due_text,
                "meeting_id": m.id,
                "meeting_title": m.title,
            }
        )
    prev = await meetings.previous_in_series(
        user_id, meeting_type, series_key(title), before or time.time(), exclude_id
    )
    if prev:
        b.last_meeting = {"id": prev.id, "title": prev.title, "started_at": prev.started_at}
        b.last_decisions = [d.text for d in await meetings.decisions(prev.id)]
        s = await meetings.latest_summary(prev.id)
        if s:
            summary = Summary.model_validate(s.sections)
            b.last_blockers = summary.blockers + [x for p in summary.per_person for x in p.blockers]
            b.last_open_questions = summary.open_questions
    return b
