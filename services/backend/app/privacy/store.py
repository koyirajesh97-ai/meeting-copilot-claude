"""Per-user privacy settings: the test-provider opt-in, retention and the consent message."""

from __future__ import annotations

from pydantic import BaseModel, Field

DEFAULT_CONSENT_MESSAGE = (
    "Heads up: I'm using Meeting Copilot to transcribe this meeting and take notes. "
    "Tell me if you'd rather I didn't, and I'll stop."
)


class PrivacySettings(BaseModel):
    #: Off by default: the only way to let meeting data reach providers that may train on it.
    allow_test_providers: bool = False
    #: Delete meetings older than this many days; None keeps them until you delete them.
    retention_days: int | None = Field(default=None, ge=1, le=3650)
    consent_message: str = Field(default=DEFAULT_CONSENT_MESSAGE, min_length=1, max_length=1000)


class InMemoryPrivacy:
    def __init__(self, meetings=None) -> None:
        self.rows: dict[str, PrivacySettings] = {}
        #: The in-memory meeting store reads retention from here.
        self._meetings = meetings

    async def get(self, user_id: str) -> PrivacySettings:
        return self.rows.get(user_id) or PrivacySettings()

    async def put(self, user_id: str, s: PrivacySettings) -> PrivacySettings:
        self.rows[user_id] = s
        retention = getattr(self._meetings, "retention", None)
        if retention is not None:
            if s.retention_days:
                retention[user_id] = s.retention_days
            else:
                retention.pop(user_id, None)
        return s

    async def delete_user(self, user_id: str) -> None:
        self.rows.pop(user_id, None)


class PostgresPrivacy:
    """Columns on public.users (migration 20261102000800_privacy.sql)."""

    def __init__(self, store) -> None:
        self.store = store

    async def get(self, user_id: str) -> PrivacySettings:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select allow_test_providers, retention_days, consent_message from public.users where id = %s",
                (user_id,),
            )
            r = await cur.fetchone()
        if not r:
            return PrivacySettings()
        return PrivacySettings(
            allow_test_providers=r[0],
            retention_days=r[1],
            consent_message=r[2] or DEFAULT_CONSENT_MESSAGE,
        )

    async def put(self, user_id: str, s: PrivacySettings) -> PrivacySettings:
        async with await self.store.connection() as conn:
            await conn.execute(
                "update public.users set allow_test_providers = %s, retention_days = %s, consent_message = %s "
                "where id = %s",
                (s.allow_test_providers, s.retention_days, s.consent_message, user_id),
            )
        return s

    async def delete_user(self, user_id: str) -> None:
        """Deleting the auth user cascades to public.users and every row that belongs to them."""
        async with await self.store.connection() as conn:
            # Through a definer function: the backend's role may not touch auth.users directly.
            await conn.execute("select public.delete_auth_user(%s)", (user_id,))
            await conn.execute("delete from public.users where id = %s", (user_id,))
