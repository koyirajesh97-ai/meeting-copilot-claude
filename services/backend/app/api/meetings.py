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
    agenda: str = Field(default="", max_length=4000)


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
    owner_id: str = ""
    #: False for project-shared meetings someone else recorded (read-only for you).
    is_mine: bool = True
    #: Being recorded right now (members can watch it live).
    is_live: bool = False


class SegmentOut(BaseModel):
    segment_id: str
    channel: str
    speaker_id: str
    text: str
    start_ms: int
    end_ms: int


class SummaryOut(BaseModel):
    status: str  # none | pending | ready | failed
    error: str | None = None
    id: str | None = None
    template: str | None = None
    model: str | None = None
    created_at: float | None = None
    #: app.summaries.schema.Summary
    data: dict | None = None


class ActionItemOut(BaseModel):
    id: str
    text: str
    owner: str | None
    due: str | None
    status: str
    source: str
    #: "I'll follow up" items: the question, who asked, and the reply drafted after the meeting.
    question: str | None = None
    asker: str | None = None
    draft: str | None = None


class DecisionOut(BaseModel):
    id: str
    text: str
    rationale: str


class MeetingDetail(MeetingOut):
    transcript: list[SegmentOut]
    summary: SummaryOut
    action_items: list[ActionItemOut]
    decisions: list[DecisionOut]
    #: Names given to diarized speakers in this meeting, e.g. {"spk_1": "Priya"}.
    speaker_names: dict[str, str]


async def summary_out(meeting_id: str) -> SummaryOut:
    store = services().meetings
    status_, error = await store.summary_status(meeting_id)
    s = await store.latest_summary(meeting_id)
    if s is None:
        return SummaryOut(status=status_, error=error)
    return SummaryOut(
        status=status_,
        error=error,
        id=s.id,
        template=s.template,
        model=s.model,
        created_at=s.created_at,
        data=s.sections,
    )


def _out(m: Meeting, user_id: str | None = None) -> MeetingOut:
    base = {k: getattr(m, k) for k in MeetingOut.model_fields if hasattr(m, k)}
    return MeetingOut(
        **base,
        is_mine=user_id is None or m.owner_id == user_id,
        is_live=services().sessions.get(m.id) is not None and m.ended_at is None,
    )


def _ws_url(request: Request, meeting_id: str) -> str:
    scheme = "wss" if request.url.scheme == "https" else "ws"
    return f"{scheme}://{request.url.netloc}/ws/meetings/{meeting_id}"


async def _owned(meeting_id: str, user_id: str) -> Meeting:
    """The meeting, if the caller owns it (needed to change anything)."""
    m = await services().meetings.get(meeting_id)
    if m is None or m.owner_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return m


async def can_read(m: Meeting, user_id: str) -> bool:
    """Owners always; project members when the meeting is shared with the project."""
    if m.owner_id == user_id:
        return True
    return (
        m.visibility == "project"
        and await services().projects.role(m.project_id, user_id) is not None
    )


async def _readable(meeting_id: str, user_id: str) -> Meeting:
    m = await services().meetings.get(meeting_id)
    if m is None or not await can_read(m, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return m


async def check_project(project_id: str | None, visibility: str, user_id: str) -> list[str]:
    """Validate a meeting's project and visibility; returns the project's vocabulary."""
    if visibility == "project" and not project_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Sharing with a project needs a project"
        )
    if not project_id:
        return []
    s = services()
    role = await s.projects.role(project_id, user_id)
    if role not in ("owner", "member"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't add meetings to this project")
    p = await s.projects.get(project_id)
    return list(p.vocabulary) if p else []


@router.post("/meetings", response_model=MeetingSocket, status_code=status.HTTP_201_CREATED)
async def create_meeting(body: CreateMeeting, request: Request, user: CurrentUser) -> MeetingSocket:
    project_vocab = await check_project(body.project_id, body.visibility, user.user_id)
    # Project vocabulary feeds transcription key terms and Clarify.
    vocab = sorted({t.strip() for t in [*body.vocabulary, *project_vocab] if t.strip()})
    m = Meeting(
        id=new_meeting_id(),
        owner_id=user.user_id,
        type=body.type,
        title=body.title,
        mode=body.mode,
        visibility=body.visibility,
        project_id=body.project_id,
        vocabulary=vocab,
        agenda=body.agenda,
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


@router.get("/meetings", response_model=list[MeetingOut])
async def list_meetings(user: CurrentUser, limit: int = 100) -> list[MeetingOut]:
    """Your meetings plus meetings shared with your projects, newest first."""
    s = services()
    n = min(max(limit, 1), 500)
    mine = await s.meetings.list_for(user.user_id, n)
    projects = [p.id for p, _role in await s.projects.for_user(user.user_id)]
    shared = await s.meetings.list_shared(projects, user.user_id, n)
    both = sorted(mine + shared, key=lambda m: m.started_at, reverse=True)[:n]
    return [_out(m, user.user_id) for m in both]


class EditMeeting(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    type: MeetingType | None = None
    visibility: Visibility | None = None
    #: "" moves the meeting out of its project.
    project_id: str | None = None


@router.patch("/meetings/{meeting_id}", response_model=MeetingOut)
async def edit_meeting(meeting_id: str, body: EditMeeting, user: CurrentUser) -> MeetingOut:
    """Rename, change type, assign to a project, or share/unshare with it (owner only)."""
    m = await _owned(meeting_id, user.user_id)
    if body.project_id is not None:
        m.project_id = body.project_id or None
        if m.project_id is None:
            m.visibility = "private"
    if body.visibility is not None:
        m.visibility = body.visibility
    await check_project(m.project_id, m.visibility, user.user_id)
    if body.title is not None:
        m.title = body.title
    if body.type is not None:
        m.type = body.type
    await services().meetings.update_meeting(m)
    return _out(m, user.user_id)


class WatchSocket(BaseModel):
    meeting_id: str
    ws_url: str
    ws_token: str


@router.post("/meetings/{meeting_id}/watch", response_model=WatchSocket)
async def watch_token(meeting_id: str, request: Request, user: CurrentUser) -> WatchSocket:
    """Watch a shared meeting live (captions and the summary; never the owner's cards)."""
    m = await _readable(meeting_id, user.user_id)
    if m.ended_at is not None and not services().sessions.watchable(m.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Meeting has ended")
    return WatchSocket(
        meeting_id=m.id,
        ws_url=_ws_url(request, m.id) + "/watch",
        ws_token=issue_token(user.user_id, scope="watch", meeting_id=m.id),
    )


@router.get("/meetings/{meeting_id}", response_model=MeetingDetail)
async def get_meeting(meeting_id: str, user: CurrentUser) -> MeetingDetail:
    m = await _readable(meeting_id, user.user_id)
    store = services().meetings
    segs = await store.segments(m.id)
    return MeetingDetail(
        **_out(m, user.user_id).model_dump(),
        transcript=[
            SegmentOut(**{k: getattr(s, k) for k in SegmentOut.model_fields}) for s in segs
        ],
        summary=await summary_out(m.id),
        action_items=[
            ActionItemOut(
                id=a.id,
                text=a.text,
                owner=a.owner,
                due=a.due_text,
                status=a.status,
                source=a.source,
                question=a.question,
                asker=a.asker,
                draft=a.draft,
            )
            for a in await store.action_items(m.id)
        ],
        decisions=[
            DecisionOut(id=d.id, text=d.text, rationale=d.rationale)
            for d in await store.decisions(m.id)
        ],
        speaker_names=await store.speaker_names(m.id),
    )


@router.post("/meetings/{meeting_id}/end", status_code=status.HTTP_204_NO_CONTENT)
async def end_meeting(meeting_id: str, user: CurrentUser) -> None:
    """Close the live session (final transcripts are flushed) and queue the summary."""
    m = await _owned(meeting_id, user.user_id)
    already_ended = m.ended_at is not None
    await services().sessions.end(meeting_id)
    # Live-only meetings keep nothing, so there's nothing to summarize.
    if not already_ended and m.mode != "live-only":
        await services().summaries.enqueue(meeting_id)


@router.get("/metrics")
async def get_metrics(_user: CurrentUser) -> dict:
    """Per-stage latency (ms): p50, p95, max, overall and per provider."""
    return {"stages": metrics.snapshot()}
