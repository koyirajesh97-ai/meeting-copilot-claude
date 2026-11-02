"""Postgres-backed meetings, transcript segments and users (tables in supabase/migrations).

The backend connects with the service role (bypassing RLS), so every query here filters by
owner explicitly; route handlers pass the caller's user id.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from .store import ActionItemRecord, DecisionRecord, Meeting, Segment, StoredSummary, SummaryStatus


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

    async def connection(self):
        """A pooled connection (opens the pool on first use)."""
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
        async with await self.connection() as conn:
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
        async with await self.connection() as conn:
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
        async with await self.connection() as conn:
            cur = conn.cursor(row_factory=dict_row)
            try:
                await cur.execute("select * from public.meetings where id = %s", (meeting_id,))
            except Exception:  # not a UUID
                return None
            row = await cur.fetchone()
            return _meeting(row) if row else None

    async def list_for(self, owner_id: str, limit: int = 100) -> list[Meeting]:
        async with await self.connection() as conn:
            cur = conn.cursor(row_factory=dict_row)
            await cur.execute(
                "select * from public.meetings where owner_id = %s order by started_at desc limit %s",
                (owner_id, limit),
            )
            return [_meeting(r) for r in await cur.fetchall()]

    async def end(self, meeting_id: str) -> Meeting | None:
        async with await self.connection() as conn:
            await conn.execute(
                "update public.meetings set ended_at = coalesce(ended_at, now()) where id = %s",
                (meeting_id,),
            )
        return await self.get(meeting_id)

    # ---------- transcript ----------

    async def add_segment(self, s: Segment) -> None:
        async with await self.connection() as conn:
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
        async with await self.connection() as conn:
            cur = await conn.execute(
                """select segment_id, channel, speaker_id, text, start_ms, end_ms, coalesce(provider, '')
                   from public.transcript_segments where meeting_id = %s order by start_ms, segment_id""",
                (meeting_id,),
            )
            return [Segment(meeting_id, *row) for row in await cur.fetchall()]

    # ---------- summaries ----------

    async def set_summary_status(
        self, meeting_id: str, status: SummaryStatus, error: str | None = None
    ) -> None:
        async with await self.connection() as conn:
            await conn.execute(
                "update public.meetings set summary_status = %s, summary_error = %s where id = %s",
                (status, error, meeting_id),
            )

    async def summary_status(self, meeting_id: str) -> tuple[SummaryStatus, str | None]:
        async with await self.connection() as conn:
            cur = await conn.execute(
                "select summary_status, summary_error from public.meetings where id = %s",
                (meeting_id,),
            )
            row = await cur.fetchone()
            return (row[0], row[1]) if row else ("none", None)

    async def save_summary(self, s: StoredSummary) -> StoredSummary:
        async with await self.connection() as conn:
            await conn.execute(
                "insert into public.summaries (id, meeting_id, template, sections, model, created_at) "
                "values (%s, %s, %s, %s, %s, %s)",
                (s.id, s.meeting_id, s.template, Jsonb(s.sections), s.model, _ts(s.created_at)),
            )
        return s

    async def latest_summary(self, meeting_id: str) -> StoredSummary | None:
        async with await self.connection() as conn:
            cur = await conn.execute(
                "select id, template, sections, model, created_at from public.summaries "
                "where meeting_id = %s order by created_at desc limit 1",
                (meeting_id,),
            )
            row = await cur.fetchone()
            if not row:
                return None
            sections = row[2] if isinstance(row[2], dict) else json.loads(row[2])
            return StoredSummary(
                str(row[0]), meeting_id, row[1], sections, row[3] or "", row[4].timestamp()
            )

    async def update_summary(self, summary_id: str, sections: dict) -> None:
        async with await self.connection() as conn:
            await conn.execute(
                "update public.summaries set sections = %s where id = %s",
                (Jsonb(sections), summary_id),
            )

    async def replace_summary_items(
        self, meeting: Meeting, items: list[ActionItemRecord], decisions: list[DecisionRecord]
    ) -> None:
        async with await self.connection() as conn, conn.transaction():
            await conn.execute(
                "delete from public.action_items where meeting_id = %s and source = 'summary'",
                (meeting.id,),
            )
            await conn.execute(
                "delete from public.decisions where meeting_id = %s and source = 'summary'",
                (meeting.id,),
            )
            for i in items:
                await self._insert_item(conn, meeting, i)
            for d in decisions:
                await conn.execute(
                    "insert into public.decisions (id, project_id, meeting_id, text, rationale, created_by, source) "
                    "values (%s, %s, %s, %s, %s, %s, %s)",
                    (
                        d.id,
                        meeting.project_id,
                        meeting.id,
                        d.text,
                        d.rationale,
                        meeting.owner_id,
                        d.source,
                    ),
                )

    async def _insert_item(self, conn, meeting: Meeting, i: ActionItemRecord) -> None:
        due: date | None = None
        if i.due_text:
            try:
                due = date.fromisoformat(i.due_text)
            except ValueError:
                due = None
        await conn.execute(
            "insert into public.action_items (id, project_id, meeting_id, owner, text, due_date, due_text, status, "
            "created_by, source) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                i.id,
                meeting.project_id,
                meeting.id,
                i.owner,
                i.text,
                due,
                i.due_text,
                i.status,
                meeting.owner_id,
                i.source,
            ),
        )

    async def add_action_item(self, meeting: Meeting, item: ActionItemRecord) -> ActionItemRecord:
        async with await self.connection() as conn:
            await self._insert_item(conn, meeting, item)
        return item

    async def action_items(self, meeting_id: str) -> list[ActionItemRecord]:
        async with await self.connection() as conn:
            cur = await conn.execute(
                "select id, text, owner, due_text, status, source, created_at from public.action_items "
                "where meeting_id = %s order by created_at, id",
                (meeting_id,),
            )
            return [
                ActionItemRecord(
                    str(r[0]), meeting_id, r[1], r[2], r[3], r[4], r[5], r[6].timestamp()
                )
                for r in await cur.fetchall()
            ]

    async def decisions(self, meeting_id: str) -> list[DecisionRecord]:
        async with await self.connection() as conn:
            cur = await conn.execute(
                "select id, text, rationale, source from public.decisions where meeting_id = %s order by created_at, id",
                (meeting_id,),
            )
            return [
                DecisionRecord(str(r[0]), meeting_id, r[1], r[2], r[3])
                for r in await cur.fetchall()
            ]

    async def set_speaker_name(self, meeting_id: str, label: str, name: str) -> None:
        async with await self.connection() as conn:
            await conn.execute(
                "insert into public.meeting_speakers (meeting_id, label, display_name) values (%s, %s, %s) "
                "on conflict (meeting_id, label) do update set display_name = excluded.display_name",
                (meeting_id, label, name),
            )

    async def speaker_names(self, meeting_id: str) -> dict[str, str]:
        async with await self.connection() as conn:
            cur = await conn.execute(
                "select label, display_name from public.meeting_speakers where meeting_id = %s",
                (meeting_id,),
            )
            return {r[0]: r[1] for r in await cur.fetchall()}
