"""Search index over chunks: hybrid of full-text and vector similarity, merged with reciprocal
rank fusion, and filtered to what the caller may see: their own meetings, project-shared
meetings and project documents in projects they belong to."""

from __future__ import annotations

import math
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from app.meetings.store import Meeting

from .chunking import Chunk

RRF_K = 60


@dataclass
class Hit:
    #: The meeting the excerpt is from ("" for project documents).
    meeting_id: str
    title: str
    started_at: float
    source_type: str  # transcript | summary | document
    text: str
    start_ms: int | None
    score: float
    document_id: str | None = None
    #: The meeting's mode; "local" hits never go to a cloud model.
    mode: str = "cloud"
    #: The meeting's mode; "local" hits never go to a cloud model.
    mode: str = "cloud"


@dataclass
class DocRef:
    """What the index needs to know about a project document."""

    id: str
    project_id: str
    title: str
    owner_id: str
    created_at: float


class SearchIndex(Protocol):
    async def replace_meeting(
        self, meeting: Meeting, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None: ...
    async def delete_meeting(self, meeting_id: str) -> None: ...
    async def replace_document(
        self, doc: DocRef, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None: ...
    async def delete_document(self, doc_id: str) -> None: ...
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
MemberCheck = Callable[[str, str], Awaitable[bool]]  # (project_id, user_id) -> is a member


class InMemoryIndex:
    def __init__(self, is_member: MemberCheck | None = None) -> None:
        self._meetings: dict[str, list[tuple[Meeting, Chunk, list[float]]]] = {}
        self._docs: dict[str, list[tuple[DocRef, Chunk, list[float]]]] = {}
        #: project_id -> member ids, for tests without a project store.
        self.members: dict[str, set[str]] = {}
        self._is_member = is_member

    async def member(self, project_id: str | None, user_id: str) -> bool:
        if not project_id:
            return False
        if user_id in self.members.get(project_id, set()):
            return True
        return bool(self._is_member and await self._is_member(project_id, user_id))

    async def replace_meeting(
        self, meeting: Meeting, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None:
        self._meetings[meeting.id] = list(
            zip([meeting] * len(chunks), chunks, vectors, strict=True)
        )

    async def delete_meeting(self, meeting_id: str) -> None:
        self._meetings.pop(meeting_id, None)

    async def replace_document(
        self, doc: DocRef, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None:
        self._docs[doc.id] = list(zip([doc] * len(chunks), chunks, vectors, strict=True))

    async def delete_document(self, doc_id: str) -> None:
        self._docs.pop(doc_id, None)

    async def search(
        self, user_id: str, query: str, vector: list[float], limit: int = 10
    ) -> list[Hit]:
        keyed: dict[str, tuple[Hit, list[float]]] = {}
        for lst in self._meetings.values():
            for m, c, v in lst:
                if m.owner_id == user_id or (
                    m.visibility == "project" and await self.member(m.project_id, user_id)
                ):
                    keyed[f"m|{m.id}|{c.source_type}|{c.source_id}"] = (
                        Hit(
                            m.id,
                            m.title,
                            m.started_at,
                            c.source_type,
                            c.text,
                            c.start_ms,
                            0,
                            None,
                            m.mode,
                        ),
                        v,
                    )
        for lst in self._docs.values():
            for d, c, v in lst:
                if await self.member(d.project_id, user_id):
                    keyed[f"d|{d.id}|{c.text[:40]}"] = (
                        Hit("", d.title, d.created_at, "document", c.text, None, 0, d.id),
                        v,
                    )
        q = set(WORD.findall(query.lower()))
        overlap = {k: len(q & set(WORD.findall(h.text.lower()))) for k, (h, _v) in keyed.items()}
        text_rank = sorted((k for k in keyed if overlap[k]), key=lambda k: -overlap[k])
        vec_rank = sorted(
            keyed, key=lambda k: -sum(a * b for a, b in zip(vector, keyed[k][1], strict=False))
        )[:50]
        out = []
        for k, s in sorted(rrf(text_rank, vec_rank).items(), key=lambda kv: -kv[1])[:limit]:
            h = keyed[k][0]
            h.score = round(s, 5)
            out.append(h)
        return out


def _vec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" if math.isfinite(x) else "0" for x in v) + "]"


IS_MEMBER = "exists (select 1 from public.project_members pm where pm.project_id = {col} and pm.user_id = %(uid)s)"
VISIBLE = f"""
  (c.meeting_id is not null and (m.owner_id = %(uid)s or (m.visibility = 'project' and {IS_MEMBER.format(col="m.project_id")})))
  or (c.meeting_id is null and c.source_type = 'document' and {IS_MEMBER.format(col="c.project_id")})
"""


class PostgresIndex:
    """Uses the meeting store's connection pool (app.meetings.pg.PostgresStore)."""

    def __init__(self, store) -> None:
        self.store = store

    async def _insert(
        self, conn, c: Chunk, v: list[float], project_id, meeting_id, owner_id
    ) -> None:
        await conn.execute(
            "insert into public.chunks (source_type, source_id, project_id, meeting_id, owner_id, text, start_ms, embedding) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s::vector)",
            (
                c.source_type,
                c.source_id,
                project_id,
                meeting_id,
                owner_id,
                c.text,
                c.start_ms,
                _vec(v),
            ),
        )

    async def replace_meeting(
        self, meeting: Meeting, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None:
        async with await self.store.connection() as conn, conn.transaction():
            await conn.execute("delete from public.chunks where meeting_id = %s", (meeting.id,))
            for c, v in zip(chunks, vectors, strict=True):
                await self._insert(conn, c, v, meeting.project_id, meeting.id, meeting.owner_id)

    async def delete_meeting(self, meeting_id: str) -> None:
        async with await self.store.connection() as conn:
            await conn.execute("delete from public.chunks where meeting_id = %s", (meeting_id,))

    async def replace_document(
        self, doc: DocRef, chunks: list[Chunk], vectors: list[list[float]]
    ) -> None:
        async with await self.store.connection() as conn, conn.transaction():
            await conn.execute(
                "delete from public.chunks where source_type = 'document' and source_id = %s",
                (doc.id,),
            )
            for c, v in zip(chunks, vectors, strict=True):
                await self._insert(conn, c, v, doc.project_id, None, doc.owner_id)

    async def delete_document(self, doc_id: str) -> None:
        async with await self.store.connection() as conn:
            await conn.execute(
                "delete from public.chunks where source_type = 'document' and source_id = %s",
                (doc_id,),
            )

    async def search(
        self, user_id: str, query: str, vector: list[float], limit: int = 10
    ) -> list[Hit]:
        sql = f"""
        with visible as (
          select c.* from public.chunks c left join public.meetings m on m.id = c.meeting_id where {VISIBLE}
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
        select c.meeting_id, coalesce(m.title, d.title), coalesce(m.started_at, d.created_at), c.source_type, c.text,
               c.start_ms, f.score, d.id, coalesce(m.mode, 'cloud')
        from fused f join public.chunks c on c.id = f.id
        left join public.meetings m on m.id = c.meeting_id
        left join public.documents d on c.source_type = 'document' and d.id::text = c.source_id
        order by f.score desc limit %(limit)s
        """
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                sql, {"uid": user_id, "q": query, "v": _vec(vector), "limit": limit}
            )
            return [
                Hit(
                    str(r[0]) if r[0] else "",
                    r[1] or "",
                    r[2].timestamp() if r[2] else 0.0,
                    r[3],
                    r[4],
                    r[5],
                    round(float(r[6]), 5),
                    str(r[7]) if r[7] else None,
                    r[8],
                )
                for r in await cur.fetchall()
            ]
