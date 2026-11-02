"""Postgres-backed meetings, transcript segments and users (tables in supabase/migrations).

The backend connects with the service role (bypassing RLS), so every query here filters by
owner explicitly; route handlers pass the caller's user id.
"""

from __future__ import annotations

from datetime import UTC, datetime

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .store import Meeting, Segment


def _ts(t: float | None) -> datetime | None:
    return None if t is None else datetime.fromtimestamp(t, UTC)


def _meeting(row: dict) -> Meeting:
    return Meeting(
        id=str(row["id"]),
        owner_id=str(row["owner_id"]),
        type=row["type"],
        title=row["title"],
        mode=row["mode"],
        visibility=row["visibility"],
        project_id=str(row["project_id"]) if row["project_id"] else None,
        started_at=row["started_at"].timestamp(),
        ended_at=row["ended_at"].timestamp() if row["ended_at"] else None,
        vocabulary=list(row["vocabulary"] or []),
    )


class PostgresStore:
    def __init__(self, dsn: str) -> None:
        self.pool = AsyncConnectionPool(
            dsn, min_size=1, max_size=5, open=False, kwargs={"autocommit": True}
        )
        self._opened = False

    async def _conn(self):
        if not self._opened:
            await self.pool.open()
            self._opened = True
        return self.pool.connection()

    async def close(self) -> None:
        if self._opened:
            await self.pool.close()

    # ---------- users ----------

    async def upsert_user(
        self, user_id: str, email: str | None, *, ensure_auth_user: bool = False
    ) -> None:
        async with await self._conn() as conn:
            if ensure_auth_user:  # dev login only: there is no Supabase Auth user behind it
                await conn.execute(
                    "insert into auth.users (id, email) values (%s, %s) on conflict (id) do nothing",
                    (user_id, email),
                )
            await conn.execute(
                """insert into public.users (id, email) values (%s, %s)
                   on conflict (id) do update set email = coalesce(excluded.email, users.email)""",
                (user_id, email),
            )

    # ---------- meetings ----------

    async def create(self, m: Meeting) -> Meeting:
        async with await self._conn() as conn:
            await conn.execute(
                """insert into public.meetings (id, project_id, owner_id, type, title, started_at, visibility, mode, vocabulary)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    m.id,
                    m.project_id,
                    m.owner_id,
                    m.type,
                    m.title,
                    _ts(m.started_at),
                    m.visibility,
                    m.mode,
                    m.vocabulary,
                ),
            )
        return m

    async def get(self, meeting_id: str) -> Meeting | None:
        async with await self._conn() as conn:
            cur = conn.cursor(row_factory=dict_row)
            try:
                await cur.execute("select * from public.meetings where id = %s", (meeting_id,))
            except Exception:  # not a UUID
                return None
            row = await cur.fetchone()
            return _meeting(row) if row else None

    async def list_for(self, owner_id: str, limit: int = 100) -> list[Meeting]:
        async with await self._conn() as conn:
            cur = conn.cursor(row_factory=dict_row)
            await cur.execute(
                "select * from public.meetings where owner_id = %s order by started_at desc limit %s",
                (owner_id, limit),
            )
            return [_meeting(r) for r in await cur.fetchall()]

    async def end(self, meeting_id: str) -> Meeting | None:
        async with await self._conn() as conn:
            await conn.execute(
                "update public.meetings set ended_at = coalesce(ended_at, now()) where id = %s",
                (meeting_id,),
            )
        return await self.get(meeting_id)

    # ---------- transcript ----------

    async def add_segment(self, s: Segment) -> None:
        async with await self._conn() as conn:
            await conn.execute(
                """insert into public.transcript_segments
                   (meeting_id, segment_id, speaker_id, channel, start_ms, end_ms, text, is_final, provider)
                   values (%s, %s, %s, %s, %s, %s, %s, true, %s)
                   on conflict (meeting_id, segment_id) do update set text = excluded.text, end_ms = excluded.end_ms""",
                (
                    s.meeting_id,
                    s.segment_id,
                    s.speaker_id,
                    s.channel,
                    s.start_ms,
                    s.end_ms,
                    s.text,
                    s.provider,
                ),
            )

    async def segments(self, meeting_id: str) -> list[Segment]:
        async with await self._conn() as conn:
            cur = await conn.execute(
                """select segment_id, channel, speaker_id, text, start_ms, end_ms, coalesce(provider, '')
                   from public.transcript_segments where meeting_id = %s order by start_ms, segment_id""",
                (meeting_id,),
            )
            return [Segment(meeting_id, *row) for row in await cur.fetchall()]
