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

from .store import (
    LIVE_ONLY_MAX_S,
    ActionItemRecord,
    ConsentEvent,
    DecisionRecord,
    Meeting,
    Segment,
    StoredSummary,
    SummaryStatus,
    series_key,
)


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
        agenda=row.get("agenda") or "",
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
                """insert into public.meetings (id, project_id, owner_id, type, title, started_at, visibility, mode, vocabulary, agenda)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
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
                    m.agenda,
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
            "created_by, source, question, asker, draft) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
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
                i.question,
                i.asker,
                i.draft,
            ),
        )

    async def add_action_item(self, meeting: Meeting, item: ActionItemRecord) -> ActionItemRecord:
        async with await self.connection() as conn:
            await self._insert_item(conn, meeting, item)
        return item

    async def action_items(self, meeting_id: str) -> list[ActionItemRecord]:
        async with await self.connection() as conn:
            cur = await conn.execute(
                "select id, text, owner, due_text, status, source, created_at, question, asker, draft "
                "from public.action_items where meeting_id = %s order by created_at, id",
                (meeting_id,),
            )
            return [
                ActionItemRecord(
                    str(r[0]),
                    meeting_id,
                    r[1],
                    r[2],
                    r[3],
                    r[4],
                    r[5],
                    r[6].timestamp(),
                    r[7],
                    r[8],
                    r[9],
                )
                for r in await cur.fetchall()
            ]

    async def set_draft(self, item_id: str, draft: str) -> None:
        async with await self.connection() as conn:
            await conn.execute(
                "update public.action_items set draft = %s where id = %s", (draft, item_id)
            )

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

    async def open_action_items(
        self, user_id: str, limit: int = 20
    ) -> list[tuple[ActionItemRecord, Meeting]]:
        async with await self.connection() as conn:
            cur = conn.cursor(row_factory=dict_row)
            await cur.execute(
                """select a.id as a_id, a.text as a_text, a.owner as a_owner, a.due_text as a_due, a.status as a_status,
                          a.source as a_source, a.created_at as a_created, a.question as a_q, a.asker as a_asker,
                          a.draft as a_draft, m.*
                   from public.action_items a join public.meetings m on m.id = a.meeting_id
                   where m.owner_id = %s and a.status = 'open' order by a.created_at desc limit %s""",
                (user_id, limit),
            )
            rows = await cur.fetchall()
        return [
            (
                ActionItemRecord(
                    str(r["a_id"]),
                    str(r["id"]),
                    r["a_text"],
                    r["a_owner"],
                    r["a_due"],
                    r["a_status"],
                    r["a_source"],
                    r["a_created"].timestamp(),
                    r["a_q"],
                    r["a_asker"],
                    r["a_draft"],
                ),
                _meeting(r),
            )
            for r in rows
        ]

    async def previous_in_series(
        self, owner_id: str, meeting_type: str, series: str, before: float, exclude_id: str | None
    ) -> Meeting | None:
        async with await self.connection() as conn:
            cur = conn.cursor(row_factory=dict_row)
            await cur.execute(
                "select * from public.meetings where owner_id = %s and type = %s and started_at < %s "
                "and id is distinct from %s::uuid order by started_at desc limit 50",
                (owner_id, meeting_type, _ts(before), exclude_id),
            )
            for r in await cur.fetchall():
                if series_key(r["title"]) == series:
                    return _meeting(r)
        return None

    async def list_shared(
        self, project_ids: list[str], exclude_owner: str, limit: int = 100
    ) -> list[Meeting]:
        if not project_ids:
            return []
        async with await self.connection() as conn:
            cur = conn.cursor(row_factory=dict_row)
            await cur.execute(
                "select * from public.meetings where visibility = 'project' and project_id = any(%s::uuid[]) "
                "and owner_id <> %s order by started_at desc limit %s",
                (project_ids, exclude_owner, limit),
            )
            return [_meeting(r) for r in await cur.fetchall()]

    async def update_meeting(self, m: Meeting) -> Meeting:
        async with await self.connection() as conn:
            await conn.execute(
                "update public.meetings set title = %s, type = %s, visibility = %s, project_id = %s, agenda = %s "
                "where id = %s",
                (m.title, m.type, m.visibility, m.project_id, m.agenda, m.id),
            )
        return m

    _ITEM_COLS = (
        "a.id as a_id, a.text as a_text, a.owner as a_owner, a.due_text as a_due, a.status as a_status, "
        "a.source as a_source, a.created_at as a_created, a.question as a_q, a.asker as a_asker, a.draft as a_draft, m.*"
    )

    @staticmethod
    def _item_row(r) -> tuple[ActionItemRecord, Meeting]:
        return (
            ActionItemRecord(
                str(r["a_id"]),
                str(r["id"]),
                r["a_text"],
                r["a_owner"],
                r["a_due"],
                r["a_status"],
                r["a_source"],
                r["a_created"].timestamp(),
                r["a_q"],
                r["a_asker"],
                r["a_draft"],
            ),
            _meeting(r),
        )

    async def project_action_items(self, project_id: str) -> list[tuple[ActionItemRecord, Meeting]]:
        async with await self.connection() as conn:
            cur = conn.cursor(row_factory=dict_row)
            await cur.execute(
                f"select {self._ITEM_COLS} from public.action_items a join public.meetings m on m.id = a.meeting_id "
                "where m.project_id = %s and m.visibility = 'project' order by a.created_at",
                (project_id,),
            )
            return [self._item_row(r) for r in await cur.fetchall()]

    async def get_action_item(self, item_id: str) -> tuple[ActionItemRecord, Meeting] | None:
        async with await self.connection() as conn:
            cur = conn.cursor(row_factory=dict_row)
            try:
                await cur.execute(
                    f"select {self._ITEM_COLS} from public.action_items a join public.meetings m on m.id = a.meeting_id "
                    "where a.id = %s",
                    (item_id,),
                )
            except Exception:
                return None
            r = await cur.fetchone()
            return self._item_row(r) if r else None

    async def update_action_item(
        self, item_id: str, *, status: str | None, owner: str | None, due_text: str | None
    ) -> None:
        sets, params = [], []
        if status is not None:
            sets.append("status = %s")
            params.append(status)
        if owner is not None:
            sets.append("owner = %s")
            params.append(owner or None)
        if due_text is not None:
            try:
                due = date.fromisoformat(due_text) if due_text else None
            except ValueError:
                due = None
            sets += ["due_text = %s", "due_date = %s"]
            params += [due_text or None, due]
        if not sets:
            return
        async with await self.connection() as conn:
            await conn.execute(
                f"update public.action_items set {', '.join(sets)} where id = %s",
                (*params, item_id),
            )

    async def detach_project(self, project_id: str) -> None:
        async with await self.connection() as conn:
            await conn.execute(
                "update public.meetings set project_id = null, visibility = 'private' where project_id = %s",
                (project_id,),
            )

    # ---------- privacy ----------

    async def add_consent_event(self, e: ConsentEvent) -> None:
        async with await self.connection() as conn:
            await conn.execute(
                "insert into public.consent_events (meeting_id, kind, note, at) values (%s, %s, %s, %s)",
                (e.meeting_id, e.kind, e.note, datetime.fromtimestamp(e.at, UTC)),
            )

    async def consent_events(self, meeting_id: str) -> list[ConsentEvent]:
        async with await self.connection() as conn:
            cur = await conn.execute(
                "select kind, note, at from public.consent_events where meeting_id = %s order by at",
                (meeting_id,),
            )
            return [
                ConsentEvent(meeting_id, r[0], r[1], r[2].timestamp()) for r in await cur.fetchall()
            ]

    async def delete_meeting(self, meeting_id: str) -> None:
        """Segments, chunks, summaries, cards, action items, decisions, names and consent events
        all cascade from the meeting row."""
        async with await self.connection() as conn:
            await conn.execute("delete from public.meetings where id = %s", (meeting_id,))

    async def expired_meetings(self, now: float) -> list[Meeting]:
        async with await self.connection() as conn:
            cur = conn.cursor(row_factory=dict_row)
            await cur.execute(
                """select m.* from public.meetings m join public.users u on u.id = m.owner_id
                   where (u.retention_days is not null
                          and m.started_at < %(now)s - make_interval(days => u.retention_days))
                      or (m.mode = 'live-only' and m.started_at < %(now)s - make_interval(secs => %(live)s))""",
                {"now": datetime.fromtimestamp(now, UTC), "live": LIVE_ONLY_MAX_S},
            )
            return [_meeting(r) for r in await cur.fetchall()]
