"""Standup entries: your rough notes for a day, and the done / doing / blockers and script made from them."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date


@dataclass
class StandupEntry:
    user_id: str
    project_id: str | None
    day: date
    notes: str = ""
    done: list[str] = field(default_factory=list)
    doing: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    script: str = ""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))


class InMemoryStandups:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str | None, date], StandupEntry] = {}

    async def upsert(self, e: StandupEntry) -> StandupEntry:
        old = self.rows.get((e.user_id, e.project_id, e.day))
        if old:
            e.id = old.id
        self.rows[(e.user_id, e.project_id, e.day)] = e
        return e

    async def get(self, user_id: str, project_id: str | None, day: date) -> StandupEntry | None:
        return self.rows.get((user_id, project_id, day))

    async def previous(
        self, user_id: str, project_id: str | None, before: date
    ) -> StandupEntry | None:
        earlier = [
            e
            for (u, p, d), e in self.rows.items()
            if u == user_id and p == project_id and d < before
        ]
        return max(earlier, key=lambda e: e.day, default=None)


class PostgresStandups:
    def __init__(self, store) -> None:
        self.store = store

    async def upsert(self, e: StandupEntry) -> StandupEntry:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                """insert into public.standup_entries (id, user_id, project_id, date, notes, done, doing, blockers, script)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (user_id, project_id, date) do update set notes = excluded.notes, done = excluded.done,
                     doing = excluded.doing, blockers = excluded.blockers, script = excluded.script
                   returning id""",
                (
                    e.id,
                    e.user_id,
                    e.project_id,
                    e.day,
                    e.notes,
                    e.done,
                    e.doing,
                    e.blockers,
                    e.script,
                ),
            )
            e.id = str((await cur.fetchone())[0])  # type: ignore[index]
        return e

    async def _one(self, where: str, params: tuple) -> StandupEntry | None:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select id, user_id, project_id, date, notes, done, doing, blockers, script from public.standup_entries "
                f"where {where} order by date desc limit 1",
                params,
            )
            r = await cur.fetchone()
        if not r:
            return None
        return StandupEntry(
            str(r[1]), str(r[2]) if r[2] else None, r[3], r[4], r[5], r[6], r[7], r[8], str(r[0])
        )

    async def get(self, user_id: str, project_id: str | None, day: date) -> StandupEntry | None:
        return await self._one(
            "user_id = %s and project_id is not distinct from %s and date = %s",
            (user_id, project_id, day),
        )

    async def previous(
        self, user_id: str, project_id: str | None, before: date
    ) -> StandupEntry | None:
        return await self._one(
            "user_id = %s and project_id is not distinct from %s and date < %s",
            (user_id, project_id, before),
        )
