"""Create, inspect and end meetings; mint the WebSocket token for a meeting's live socket."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.auth import CurrentUser, issue_token
from app.meetings.store import Meeting, MeetingMode, MeetingType, Visibility, new_meeting_id
from app.metrics import metrics
from app.services import services

router = APIRouter()


class CreateMeeting(BaseModel):
    type: MeetingType = "custom"
    title: str = Field(default="Untitled meeting", max_length=200)
    mode: MeetingMode = "cloud"
    visibility: Visibility = "private"
    project_id: str | None = None
    #: Names and terms for this meeting; project vocabulary is merged in once projects exist.
    vocabulary: list[str] = Field(default_factory=list, max_length=500)


class MeetingSocket(BaseModel):
    meeting_id: str
    ws_url: str
    ws_token: str


class MeetingOut(BaseModel):
    id: str
    type: str
    title: str
    mode: str
    visibility: str
    project_id: str | None
    started_at: float
    ended_at: float | None


def _ws_url(request: Request, meeting_id: str) -> str:
    scheme = "wss" if request.url.scheme == "https" else "ws"
    return f"{scheme}://{request.url.netloc}/ws/meetings/{meeting_id}"


async def _owned(meeting_id: str, user_id: str) -> Meeting:
    m = await services().meetings.get(meeting_id)
    if m is None or m.owner_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return m


@router.post("/meetings", response_model=MeetingSocket, status_code=status.HTTP_201_CREATED)
async def create_meeting(body: CreateMeeting, request: Request, user: CurrentUser) -> MeetingSocket:
    vocab = sorted({t.strip() for t in body.vocabulary if t.strip()})
    m = Meeting(
        id=new_meeting_id(),
        owner_id=user.user_id,
        type=body.type,
        title=body.title,
        mode=body.mode,
        visibility=body.visibility,
        project_id=body.project_id,
        vocabulary=vocab,
    )
    await services().meetings.create(m)
    return MeetingSocket(
        meeting_id=m.id,
        ws_url=_ws_url(request, m.id),
        ws_token=issue_token(user.user_id, scope="ws", meeting_id=m.id),
    )


@router.post("/meetings/{meeting_id}/ws-token", response_model=MeetingSocket)
async def refresh_ws_token(meeting_id: str, request: Request, user: CurrentUser) -> MeetingSocket:
    """A fresh short-lived socket token, for reconnecting."""
    m = await _owned(meeting_id, user.user_id)
    if m.ended_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Meeting has ended")
    return MeetingSocket(
        meeting_id=m.id,
        ws_url=_ws_url(request, m.id),
        ws_token=issue_token(user.user_id, scope="ws", meeting_id=m.id),
    )


@router.get("/meetings/{meeting_id}", response_model=MeetingOut)
async def get_meeting(meeting_id: str, user: CurrentUser) -> MeetingOut:
    m = await _owned(meeting_id, user.user_id)
    return MeetingOut(**{k: getattr(m, k) for k in MeetingOut.model_fields})


@router.post("/meetings/{meeting_id}/end", status_code=status.HTTP_204_NO_CONTENT)
async def end_meeting(meeting_id: str, user: CurrentUser) -> None:
    """Close the live session (final transcripts are flushed). The summary job arrives in Prompt 7."""
    await _owned(meeting_id, user.user_id)
    await services().sessions.end(meeting_id)


@router.get("/metrics")
async def get_metrics(_user: CurrentUser) -> dict:
    """Per-stage latency (ms): p50, p95, max, overall and per provider."""
    return {"stages": metrics.snapshot()}
