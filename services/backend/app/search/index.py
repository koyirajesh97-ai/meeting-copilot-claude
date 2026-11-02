"""Search index over chunks: hybrid of full-text and vector similarity, merged with reciprocal
rank fusion, and filtered to what the caller may see (their own meetings, plus project-shared
meetings in projects they belong to)."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Protocol

from app.meetings.store import Meeting

from .chunking import Chunk

RRF_K = 60


@dataclass
class Hit:
    meeting_id: str
    title: str
    started_at: float
    source_type: str
    text: str
    start_ms: int | None
    score: float


class SearchIndex(Protocol):
    async def replace_meeting(
        self, meeting: Meeting, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None: ...
    async def delete_meeting(self, meeting_id: str) -> None: ...
    async def search(
        self, user_id: str, query: str, vector: list[float], limit: int = 10
    ) -> list[Hit]: ...


def rrf(*rankings: list[str]) -> dict[str, float]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, key in enumerate(ranking):
            scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank + 1)
    return scores


WORD = re.compile(r"[a-z0-9]+")


class InMemoryIndex:
    def __init__(self) -> None:
        self._rows: dict[str, list[tuple[Meeting, Chunk, list[float]]]] = {}
        #: project_id -> member user ids (Phase 3 fills this; tests set it directly)
        self.members: dict[str, set[str]] = {}

    async def replace_meeting(
        self, meeting: Meeting, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None:
        self._rows[meeting.id] = list(zip([meeting] * len(chunks), chunks, vectors, strict=True))

    async def delete_meeting(self, meeting_id: str) -> None:
        self._rows.pop(meeting_id, None)

    def _visible(self, m: Meeting, user_id: str) -> bool:
        return m.owner_id == user_id or (
            m.visibility == "project"
            and m.project_id is not None
            and user_id in self.members.get(m.project_id, set())
        )

    async def search(
        self, user_id: str, query: str, vector: list[float], limit: int = 10
    ) -> list[Hit]:
        rows = [
            (m, c, v) for lst in self._rows.values() for m, c, v in lst if self._visible(m, user_id)
        ]
        q = set(WORD.findall(query.lower()))
        keyed = {f"{m.id}|{c.source_type}|{c.source_id}": (m, c, v) for m, c, v in rows}
        text_rank = sorted(
            (k for k, (_m, c, _v) in keyed.items() if q & set(WORD.findall(c.text.lower()))),
            key=lambda k: -len(q & set(WORD.findall(keyed[k][1].text.lower()))),
        )
        vec_rank = sorted(
            keyed, key=lambda k: -sum(a * b for a, b in zip(vector, keyed[k][2], strict=False))
        )[:50]
        scores = rrf(text_rank, vec_rank)
        out = []
        for k, s in sorted(scores.items(), key=lambda kv: -kv[1])[:limit]:
            m, c, _ = keyed[k]
            out.append(
                Hit(m.id, m.title, m.started_at, c.source_type, c.text, c.start_ms, round(s, 5))
            )
        return out


def _vec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" if math.isfinite(x) else "0" for x in v) + "]"


VISIBLE = """
  (m.owner_id = %(uid)s or (m.visibility = 'project' and exists (
     select 1 from public.project_members pm where pm.project_id = m.project_id and pm.user_id = %(uid)s)))
"""


class PostgresIndex:
    """Uses the meeting store's connection pool (app.meetings.pg.PostgresStore)."""

    def __init__(self, store) -> None:
        self.store = store

    async def replace_meeting(
        self, meeting: Meeting, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None:
        async with await self.store.connection() as conn, conn.transaction():
            await conn.execute("delete from public.chunks where meeting_id = %s", (meeting.id,))
            for c, v in zip(chunks, vectors, strict=True):
                await conn.execute(
                    "insert into public.chunks (source_type, source_id, project_id, meeting_id, owner_id, text, start_ms, embedding) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s::vector)",
                    (
                        c.source_type,
                        c.source_id,
                        meeting.project_id,
                        meeting.id,
                        meeting.owner_id,
                        c.text,
                        c.start_ms,
                        _vec(v),
                    ),
                )

    async def delete_meeting(self, meeting_id: str) -> None:
        async with await self.store.connection() as conn:
            await conn.execute("delete from public.chunks where meeting_id = %s", (meeting_id,))

    async def search(
        self, user_id: str, query: str, vector: list[float], limit: int = 10
    ) -> list[Hit]:
        sql = f"""
        with visible as (
          select c.* from public.chunks c join public.meetings m on m.id = c.meeting_id where {VISIBLE}
        ),
        fts as (
          select id, row_number() over (order by ts_rank_cd(tsv, q) desc) as r
          from visible, websearch_to_tsquery('english', %(q)s) q where tsv @@ q limit 50
        ),
        vec as (
          select id, row_number() over (order by embedding <=> %(v)s::vector) as r
          from visible where embedding is not null order by embedding <=> %(v)s::vector limit 50
        ),
        fused as (
          select id, sum(1.0 / ({RRF_K} + r)) as score from (select * from fts union all select * from vec) x group by id
        )
        select c.meeting_id, m.title, m.started_at, c.source_type, c.text, c.start_ms, f.score
        from fused f join public.chunks c on c.id = f.id join public.meetings m on m.id = c.meeting_id
        order by f.score desc limit %(limit)s
        """
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                sql, {"uid": user_id, "q": query, "v": _vec(vector), "limit": limit}
            )
            return [
                Hit(str(r[0]), r[1], r[2].timestamp(), r[3], r[4], r[5], round(float(r[6]), 5))
                for r in await cur.fetchall()
            ]
