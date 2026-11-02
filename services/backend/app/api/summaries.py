"""Summary routes: status, edit, regenerate with another template, Markdown export, speaker names."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from app.auth import CurrentUser
from app.jobs.summary import items_from
from app.services import services
from app.summaries.markdown import meeting_markdown
from app.summaries.schema import Summary
from app.summaries.templates import TEMPLATES

from .meetings import SummaryOut, _owned, summary_out

router = APIRouter()


class TemplateOut(BaseModel):
    id: str
    label: str
    sections: list[dict[str, str]]
    per_person: bool


@router.get("/templates", response_model=list[TemplateOut])
async def list_templates(_user: CurrentUser) -> list[TemplateOut]:
    return [
        TemplateOut(
            id=t.id,
            label=t.label,
            sections=[{"key": s.key, "title": s.title} for s in t.sections],
            per_person=t.per_person,
        )
        for t in TEMPLATES.values()
    ]


@router.get("/meetings/{meeting_id}/summary", response_model=SummaryOut)
async def get_summary(meeting_id: str, user: CurrentUser) -> SummaryOut:
    await _owned(meeting_id, user.user_id)
    return await summary_out(meeting_id)


class Regenerate(BaseModel):
    template: str | None = None


@router.post(
    "/meetings/{meeting_id}/summary/regenerate",
    response_model=SummaryOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def regenerate(meeting_id: str, body: Regenerate, user: CurrentUser) -> SummaryOut:
    m = await _owned(meeting_id, user.user_id)
    if body.template and body.template not in TEMPLATES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown template {body.template!r}"
        )
    if m.mode == "live-only":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Live-only meetings keep no transcript to summarize"
        )
    await services().summaries.enqueue(meeting_id, body.template)
    return await summary_out(meeting_id)


class EditSummary(BaseModel):
    data: Summary


@router.put("/meetings/{meeting_id}/summary", response_model=SummaryOut)
async def edit_summary(meeting_id: str, body: EditSummary, user: CurrentUser) -> SummaryOut:
    """Save the user's edits to the latest summary (overview, sections, lists)."""
    m = await _owned(meeting_id, user.user_id)
    store = services().meetings
    s = await store.latest_summary(meeting_id)
    if s is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No summary to edit yet")
    await store.update_summary(s.id, body.data.model_dump())
    # Edited action items and decisions replace the ones the summary created (manual ones stay).
    await store.replace_summary_items(m, *items_from(m, body.data))
    return await summary_out(meeting_id)


class Rename(BaseModel):
    display_name: str = Field(min_length=1, max_length=100)


@router.post(
    "/meetings/{meeting_id}/speakers/{label}/rename", status_code=status.HTTP_204_NO_CONTENT
)
async def rename_speaker(meeting_id: str, label: str, body: Rename, user: CurrentUser) -> None:
    """Name "Speaker 2" for this meeting. Text only: this never creates a voiceprint."""
    await _owned(meeting_id, user.user_id)
    if not label.startswith("spk_"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Only diarized speakers (spk_N) can be renamed"
        )
    await services().meetings.set_speaker_name(meeting_id, label, body.display_name.strip())


@router.get("/meetings/{meeting_id}/export")
async def export(
    meeting_id: str, user: CurrentUser, format: str = "md", transcript: bool = True
) -> PlainTextResponse:
    if format != "md":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Only format=md is supported")
    m = await _owned(meeting_id, user.user_id)
    store = services().meetings
    s = await store.latest_summary(meeting_id)
    text = meeting_markdown(
        m,
        Summary.model_validate(s.sections) if s else None,
        await store.action_items(meeting_id),
        await store.segments(meeting_id),
        await store.speaker_names(meeting_id),
        include_transcript=transcript,
    )
    return PlainTextResponse(text, media_type="text/markdown; charset=utf-8")


class CardOut(BaseModel):
    id: str
    kind: str
    text: str
    sources: list[dict]
    confidence: float
    provider: str | None
    used: bool | None


@router.get("/meetings/{meeting_id}/cards", response_model=list[CardOut])
async def meeting_cards(meeting_id: str, user: CurrentUser) -> list[CardOut]:
    """Cards shown during the meeting (private to its owner) and whether they helped."""
    await _owned(meeting_id, user.user_id)
    return [
        CardOut(
            id=c.id,
            kind=c.kind,
            text=c.text,
            sources=c.sources,
            confidence=c.confidence,
            provider=c.provider,
            used=c.used,
        )
        for c in await services().cards.for_meeting(meeting_id)
    ]
