"""POST /standup, GET/PUT /standup/today, GET /brief."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import CurrentUser
from app.meetings.store import MeetingType
from app.services import services
from app.standup.service import build_brief, today
from app.standup.store import StandupEntry

router = APIRouter()


class StandupIn(BaseModel):
    notes: str = Field(min_length=1, max_length=4000)
    project_id: str | None = None


class StandupOut(BaseModel):
    id: str
    date: str
    project_id: str | None
    notes: str
    done: list[str]
    doing: list[str]
    blockers: list[str]
    script: str


def _out(e: StandupEntry) -> StandupOut:
    return StandupOut(
        id=e.id,
        date=e.day.isoformat(),
        project_id=e.project_id,
        notes=e.notes,
        done=e.done,
        doing=e.doing,
        blockers=e.blockers,
        script=e.script,
    )


@router.post("/standup", response_model=StandupOut)
async def generate(body: StandupIn, user: CurrentUser) -> StandupOut:
    """Rough notes in; done / doing / blockers and a 30-second script out (saved for today)."""
    return _out(await services().standup.generate(user.user_id, body.notes, body.project_id))


@router.get("/standup/today", response_model=StandupOut | None)
async def get_today(user: CurrentUser, project_id: str | None = None) -> StandupOut | None:
    e = await services().standups.get(user.user_id, project_id, today())
    return _out(e) if e else None


class StandupEdit(BaseModel):
    done: list[str] = []
    doing: list[str] = []
    blockers: list[str] = []
    script: str = Field(default="", max_length=3000)
    project_id: str | None = None


@router.put("/standup/today", response_model=StandupOut)
async def edit_today(body: StandupEdit, user: CurrentUser) -> StandupOut:
    store = services().standups
    e = await store.get(user.user_id, body.project_id, today())
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Generate today's standup first")
    e.done, e.doing, e.blockers, e.script = body.done, body.doing, body.blockers, body.script
    return _out(await store.upsert(e))


class BriefOut(BaseModel):
    open_action_items: list[dict]
    last_meeting: dict | None
    last_decisions: list[str]
    last_blockers: list[str]
    last_open_questions: list[str]
    agenda: str


@router.get("/brief", response_model=BriefOut)
async def brief(
    user: CurrentUser,
    meeting_id: str | None = None,
    title: str = "",
    type: MeetingType = "custom",
    agenda: str = "",
) -> BriefOut:
    """Before a meeting: your open action items, and the last decisions/blockers of this series."""
    s = services()
    before = None
    if meeting_id:
        m = await s.meetings.get(meeting_id)
        if m is None or m.owner_id != user.user_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
        title, type, agenda, before = m.title, m.type, agenda or m.agenda, m.started_at
    b = await build_brief(
        s.meetings, user.user_id, title, type, agenda, exclude_id=meeting_id, before=before
    )
    return BriefOut(**asdict(b))
