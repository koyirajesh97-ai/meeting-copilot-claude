"""Indexing, search and "Ask my meetings"."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import BaseModel

from app.meetings.store import Meeting, MeetingStore, StoredSummary
from app.prompts import load
from app.providers.embeddings import EmbeddingRouter
from app.router.router import Router
from app.summaries.pipeline import clock
from app.summaries.schema import Summary

from .chunking import summary_chunks, transcript_chunks
from .index import Hit, SearchIndex

log = logging.getLogger("app.search")

ASK_CONTEXT_CHUNKS = 8
NOT_FOUND = "I couldn't find that in your meetings."


class AskOut(BaseModel):
    answer: str = ""
    citations: list[str] = []
    found: bool = False


@dataclass
class Citation:
    id: str
    meeting_id: str
    title: str
    start_ms: int | None
    quote: str


@dataclass
class Answer:
    answer: str
    found: bool
    citations: list[Citation]
    provider: str | None


def _when(t: float) -> str:
    return datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%d")


class SearchService:
    def __init__(
        self, index: SearchIndex, embedder: EmbeddingRouter, router: Router, store: MeetingStore
    ) -> None:
        self.index = index
        self.embedder = embedder
        self.router = router
        self.store = store

    async def index_meeting(self, meeting: Meeting, summary: StoredSummary | None = None) -> int:
        """(Re)index a meeting's transcript and summary. Runs after summary.ready."""
        names = await self.store.speaker_names(meeting.id)
        chunks = transcript_chunks(await self.store.segments(meeting.id), names)
        if summary is not None:
            chunks += summary_chunks(Summary.model_validate(summary.sections))
        vectors, provider = await self.embedder.embed([c.text for c in chunks], "meeting")
        await self.index.replace_meeting(meeting, chunks, vectors)
        log.info("indexed meeting=%s chunks=%d embedder=%s", meeting.id, len(chunks), provider)
        return len(chunks)

    async def search(self, user_id: str, query: str, limit: int = 10) -> list[Hit]:
        query = query.strip()
        if not query:
            return []
        [vector], _ = await self.embedder.embed([query], "meeting")
        return await self.index.search(user_id, query, vector, limit)

    async def ask(self, user_id: str, question: str) -> Answer:
        hits = await self.search(user_id, question, ASK_CONTEXT_CHUNKS)
        if not hits:
            return Answer(NOT_FOUND, False, [], None)
        ids = {f"c{i + 1}": h for i, h in enumerate(hits)}
        context = "\n".join(
            f"[{cid}] {h.title}, {_when(h.started_at)}"
            + (f" at {clock(h.start_ms)}" if h.start_ms is not None else " (summary)")
            + f": {' '.join(h.text.split())}"
            for cid, h in ids.items()
        )
        out = await self.router.complete(
            "ask", load("ask").render(question=question, context=context), "meeting", AskOut
        )
        parsed: AskOut = out.json
        # Only keep citations to excerpts we actually sent.
        cited = [c for c in dict.fromkeys(parsed.citations) if c in ids]
        if not parsed.found or not parsed.answer.strip() or not cited:
            return Answer(NOT_FOUND, False, [], out.provider)
        return Answer(
            parsed.answer.strip(),
            True,
            [
                Citation(c, ids[c].meeting_id, ids[c].title, ids[c].start_ms, ids[c].text[:300])
                for c in cited
            ],
            out.provider,
        )
