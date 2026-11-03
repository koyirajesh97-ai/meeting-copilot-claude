"""Per-user integration settings. Secrets are sealed with INTEGRATIONS_KEY (Fernet)."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger("app.integrations")


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = os.environ.get("INTEGRATIONS_KEY")
    if key:
        return Fernet(key.encode())
    log.warning("INTEGRATIONS_KEY is not set; deriving a development key from BACKEND_SECRET")
    from app.auth import backend_secret

    return Fernet(
        base64.urlsafe_b64encode(
            hashlib.sha256(b"integrations:" + backend_secret().encode()).digest()
        )
    )


def seal(secret: dict) -> bytes:
    return _fernet().encrypt(json.dumps(secret).encode())


def unseal(blob: bytes | None) -> dict:
    if not blob:
        return {}
    try:
        return json.loads(_fernet().decrypt(bytes(blob)))
    except InvalidToken:
        log.warning("an integration secret can't be decrypted with the current INTEGRATIONS_KEY")
        return {}


@dataclass
class Integration:
    user_id: str
    kind: str
    enabled: bool = True
    config: dict = field(default_factory=dict)
    secret: dict = field(default_factory=dict)
    last_error: str | None = None


class InMemoryIntegrations:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], tuple[Integration, bytes]] = {}

    async def get(self, user_id: str, kind: str) -> Integration | None:
        row = self.rows.get((user_id, kind))
        if not row:
            return None
        i, blob = row
        return Integration(i.user_id, i.kind, i.enabled, dict(i.config), unseal(blob), i.last_error)

    async def for_user(self, user_id: str) -> list[Integration]:
        return [i for k in sorted(self.rows) if k[0] == user_id if (i := await self.get(*k))]

    async def put(self, i: Integration) -> None:
        stored = Integration(i.user_id, i.kind, i.enabled, dict(i.config), {}, i.last_error)
        self.rows[(i.user_id, i.kind)] = (stored, seal(i.secret))

    async def delete(self, user_id: str, kind: str) -> None:
        self.rows.pop((user_id, kind), None)


class PostgresIntegrations:
    def __init__(self, store) -> None:
        self.store = store

    @staticmethod
    def _row(r) -> Integration:
        return Integration(str(r[0]), r[1], r[2], r[3] or {}, unseal(r[4]), r[5])

    async def get(self, user_id: str, kind: str) -> Integration | None:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select user_id, kind, enabled, config, secret, last_error from public.user_integrations "
                "where user_id = %s and kind = %s",
                (user_id, kind),
            )
            r = await cur.fetchone()
        return self._row(r) if r else None

    async def for_user(self, user_id: str) -> list[Integration]:
        async with await self.store.connection() as conn:
            cur = await conn.execute(
                "select user_id, kind, enabled, config, secret, last_error from public.user_integrations "
                "where user_id = %s order by kind",
                (user_id,),
            )
            return [self._row(r) for r in await cur.fetchall()]

    async def put(self, i: Integration) -> None:
        from psycopg.types.json import Jsonb

        async with await self.store.connection() as conn:
            await conn.execute(
                """insert into public.user_integrations (user_id, kind, enabled, config, secret, last_error, updated_at)
                   values (%s, %s, %s, %s, %s, %s, now())
                   on conflict (user_id, kind) do update set enabled = excluded.enabled, config = excluded.config,
                     secret = excluded.secret, last_error = excluded.last_error, updated_at = now()""",
                (i.user_id, i.kind, i.enabled, Jsonb(i.config), seal(i.secret), i.last_error),
            )

    async def delete(self, user_id: str, kind: str) -> None:
        async with await self.store.connection() as conn:
            await conn.execute(
                "delete from public.user_integrations where user_id = %s and kind = %s",
                (user_id, kind),
            )
