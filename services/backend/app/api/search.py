"""GET /search (hybrid full-text + semantic) and POST /ask (cited answers across meetings)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.auth import CurrentUser
from app.ratelimit import AI_ACTIONS
from app.services import services

router = APIRouter()


class HitOut(BaseModel):
    meeting_id: str
    title: str
    started_at: float
    source_type: str
    text: str
    start_ms: int | None
    score: float
    document_id: str | None = None


@router.get("/search", response_model=list[HitOut])
async def search(q: str, user: CurrentUser, limit: int = 10) -> list[HitOut]:
    hits = await services().search.search(user.user_id, q[:500], min(max(limit, 1), 50))
    return [HitOut(**h.__dict__) for h in hits]


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


class CitationOut(BaseModel):
    id: str
    meeting_id: str
    title: str
    start_ms: int | None
    quote: str
    document_id: str | None = None


class AnswerOut(BaseModel):
    answer: str
    found: bool
    citations: list[CitationOut]
    provider: str | None


@router.post("/ask", response_model=AnswerOut)
async def ask(body: AskIn, user: CurrentUser) -> AnswerOut:
    AI_ACTIONS.check(user.user_id)
    a = await services().search.ask(user.user_id, body.question)
    return AnswerOut(
        answer=a.answer,
        found=a.found,
        citations=[CitationOut(**c.__dict__) for c in a.citations],
        provider=a.provider,
    )
