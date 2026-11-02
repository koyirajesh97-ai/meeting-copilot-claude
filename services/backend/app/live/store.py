"""Cards shown during a meeting (public.suggestions), and whether they helped."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

from psycopg.types.json import Jsonb


@dataclass
class CardRecord:
    id: str
    meeting_id: str
    kind: str
    text: str
    sources: list[dict]
    confidence: float
    provider: str | None
    trigger_segment_id: str | None = None
    used: bool | None = None
    created_at: float = field(default_factory=time.time)


class InMemoryCards:
    def __init__(self) -> None:
        self.rows: dict[str, CardRecord] = {}

    async def add(self, card: CardRecord) -> CardRecord:
        self.rows[card.id] = card
        return card

    async def update_text(self, card_id: str, text: str, sources: list[dict]) -> None:
        if card_id in self.rows:
            self.rows[card_id].text, self.rows[card_id].sources = text, sources

    async def feedback(self, meeting_id: str, card_id: str, used: bool) -> bool:
        c = self.rows.get(card_id)
        if not c or c.meeting_id != meeting_id:
            return False
        c.used = used
        return True

    async def delete_for_meeting(self, meeting_id: str) -> None:
        for k in [k for k, c in self.rows.items() if c.meeting_id == meeting_id]:
            del self.rows[k]

    async def for_meeting(self, meeting_id: str) -> list[CardRecord]:
        return sorted(
            (c for c in self.rows.values() if c.meeting_id == meeting_id),
            key=lambda c: c.created_at,
        )


class PostgresCards:
    def __init__(self, store) -> None:
        self.store = store

    async def add(self, c: CardRecord) -> CardRecord:
        async with await self.store.connection() as conn:
            await conn.execute(
                "insert into public.suggestions (id, meeting_id, kind, trigger_segment_id, text, sources, confidence, provider) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    c.id,
                    c.meeting_id,
                    c.kind,
                    c.trigger_segment_id,
                    c.text,
                    Jsonb(c.sources),
                    c.confidence,
                    c.provider,
                ),
            )
        return c

    async def update_text(self, card_id: str, text: str, sources: list[dict]) -> None:
        async with await self.store.connection() as conn:
            await conn.execute(
                "update public.suggestions set text = %s, sources = %s where id = %s",
                (text, Jsonb(sources), card_id),
            )

    async def feedback(self, meeting_id: str, card_id: str, used: bool) -> bool:
        async with await self.store.connection() as conn:
            try:
                cur = await conn.execute(
                    "update public.suggestions set used = %s where id = %s and meeting_id = %s",
                    (used, card_id, meeting_id),
                )
            except Exception:  # not a UUID
                return False
            return cur.rowcount > 0

    async def for_meeting(self, meeting_id: str) -> list[CardRecord]:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select id, kind, text, sources, confidence, provider, trigger_segment_id, used, created_at "
                "from public.suggestions where meeting_id = %s order by created_at",
                (meeting_id,),
            )
            return [
                CardRecord(
                    str(r[0]),
                    meeting_id,
                    r[1],
                    r[2],
                    r[3],
                    r[4] or 0,
                    r[5],
                    r[6],
                    r[7],
                    r[8].timestamp(),
                )
                for r in await cur.fetchall()
            ]


def new_card_id() -> str:
    return str(uuid.uuid4())
