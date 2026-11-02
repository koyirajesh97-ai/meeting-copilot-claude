"""QuotaStore backed by the Postgres `provider_usage` table (see supabase/migrations)."""

from __future__ import annotations

from datetime import date

from psycopg import AsyncConnection

from .quota import Usage, UsageRow


class PostgresQuotaStore:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    async def add(
        self,
        provider: str,
        model: str,
        task: str,
        day: date,
        requests: int,
        tokens: int,
        audio_seconds: float,
    ) -> None:
        async with await AsyncConnection.connect(self.dsn, autocommit=True) as conn:
            await conn.execute(
                """
                insert into public.provider_usage (provider, model, task, day, requests, tokens, audio_seconds)
                values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (provider, model, task, day) do update set
                  requests = provider_usage.requests + excluded.requests,
                  tokens = provider_usage.tokens + excluded.tokens,
                  audio_seconds = provider_usage.audio_seconds + excluded.audio_seconds,
                  updated_at = now()
                """,
                (provider, model, task, day, requests, tokens, audio_seconds),
            )

    async def totals(self, provider: str, model: str, day: date) -> Usage:
        async with await AsyncConnection.connect(self.dsn) as conn:
            cur = await conn.execute(
                """select coalesce(sum(requests), 0), coalesce(sum(tokens), 0), coalesce(sum(audio_seconds), 0)
                   from public.provider_usage where provider = %s and model = %s and day = %s""",
                (provider, model, day),
            )
            r, t, a = await cur.fetchone()  # type: ignore[misc]
            return Usage(int(r), int(t), float(a))

    async def rows(self, day: date) -> list[UsageRow]:
        async with await AsyncConnection.connect(self.dsn) as conn:
            cur = await conn.execute(
                """select provider, model, task, day, requests, tokens, audio_seconds
                   from public.provider_usage where day = %s order by provider, model, task""",
                (day,),
            )
            return [
                UsageRow(p, m, t, d, Usage(r, k, float(a)))
                for p, m, t, d, r, k, a in await cur.fetchall()
            ]
