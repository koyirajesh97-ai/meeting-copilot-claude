"""Enrolled speakers (with consent). In memory or Postgres (public.speakers)."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime


@dataclass
class EnrolledSpeaker:
    id: str
    user_id: str
    project_id: str | None
    display_name: str
    voiceprint: bytes  # sealed (app.voiceprints)
    consent_at: float = field(default_factory=time.time)


class InMemorySpeakers:
    def __init__(self) -> None:
        self.rows: dict[str, EnrolledSpeaker] = {}

    async def enroll(
        self, user_id: str, project_id: str | None, name: str, sealed: bytes
    ) -> EnrolledSpeaker:
        for k, s in list(self.rows.items()):
            if s.user_id == user_id and s.project_id == project_id:
                del self.rows[k]  # re-enrolling replaces the old voiceprint
        s = EnrolledSpeaker(str(uuid.uuid4()), user_id, project_id, name, sealed)
        self.rows[s.id] = s
        return s

    async def mine(self, user_id: str) -> list[EnrolledSpeaker]:
        return [s for s in self.rows.values() if s.user_id == user_id]

    async def candidates(self, owner_id: str, project_id: str | None) -> list[EnrolledSpeaker]:
        """Voices that may be recognized in a meeting: the owner's, and the project's members'."""
        return [
            s
            for s in self.rows.values()
            if (s.user_id == owner_id and s.project_id is None)
            or (project_id and s.project_id == project_id)
        ]

    async def delete_for_member(self, project_id: str, user_id: str) -> None:
        for k, s in list(self.rows.items()):
            if s.project_id == project_id and s.user_id == user_id:
                del self.rows[k]

    async def delete(self, speaker_id: str, user_id: str) -> bool:
        s = self.rows.get(speaker_id)
        if s is None or s.user_id != user_id:
            return False
        del self.rows[speaker_id]
        return True


class PostgresSpeakers:
    def __init__(self, store) -> None:
        self.store = store  # app.meetings.pg.PostgresStore (shares its pool)

    async def enroll(
        self, user_id: str, project_id: str | None, name: str, sealed: bytes
    ) -> EnrolledSpeaker:
        async with await self.store.connection() as conn, conn.transaction():
            await conn.execute(
                "delete from public.speakers where user_id = %s and project_id is not distinct from %s",
                (user_id, project_id),
            )
            cur = await conn.execute(
                "insert into public.speakers (project_id, user_id, display_name, voiceprint, consent_at) "
                "values (%s, %s, %s, %s, now()) returning id, consent_at",
                (project_id, user_id, name, sealed),
            )
            sid, at = await cur.fetchone()  # type: ignore[misc]
        return EnrolledSpeaker(str(sid), user_id, project_id, name, sealed, at.timestamp())

    async def _rows(self, where: str, params: tuple) -> list[EnrolledSpeaker]:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select id, user_id, project_id, display_name, voiceprint, consent_at from public.speakers "
                f"where voiceprint is not null and ({where})",
                params,
            )
            return [
                EnrolledSpeaker(
                    str(r[0]),
                    str(r[1]),
                    str(r[2]) if r[2] else None,
                    r[3],
                    bytes(r[4]),
                    (r[5] or datetime.now(UTC)).timestamp(),
                )
                for r in await cur.fetchall()
            ]

    async def mine(self, user_id: str) -> list[EnrolledSpeaker]:
        return await self._rows("user_id = %s", (user_id,))

    async def candidates(self, owner_id: str, project_id: str | None) -> list[EnrolledSpeaker]:
        return await self._rows(
            "(user_id = %s and project_id is null) or (%s::uuid is not null and project_id = %s::uuid)",
            (owner_id, project_id, project_id),
        )

    async def delete(self, speaker_id: str, user_id: str) -> bool:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "delete from public.speakers where id = %s and user_id = %s", (speaker_id, user_id)
            )
            return cur.rowcount > 0

    async def delete_for_member(self, project_id: str, user_id: str) -> None:
        # The project_members delete trigger does this too; doing it here keeps both stores alike.
        async with await self.store.connection() as conn:
            await conn.execute(
                "delete from public.speakers where project_id = %s and user_id = %s",
                (project_id, user_id),
            )
