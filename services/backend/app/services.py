"""The app's shared services (router, STT registry, quota), built once from config.

Tests replace them with `set_services(...)` to inject fakes.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from app.meetings.store import InMemoryMeetingStore, MeetingStore
from app.realtime.manager import SessionManager
from app.router.client import CompletionClient, LiteLLMClient
from app.router.config import RouterConfig, load_config
from app.router.quota import Cooldowns, InMemoryQuotaStore, QuotaStore, QuotaTracker
from app.router.router import Router
from app.router.stt import SttRegistry


@dataclass
class Services:
    config: RouterConfig
    quota: QuotaTracker
    router: Router
    stt: SttRegistry
    meetings: MeetingStore
    sessions: SessionManager


def build_services(
    config: RouterConfig | None = None,
    client: CompletionClient | None = None,
    store: QuotaStore | None = None,
    stt_factory=None,
    meetings: MeetingStore | None = None,
) -> Services:
    cfg = config or load_config()
    if store is None:
        dsn = os.environ.get("DATABASE_URL")
        if dsn:
            from app.router.quota_pg import PostgresQuotaStore

            store = PostgresQuotaStore(dsn)
        else:
            store = InMemoryQuotaStore()
    quota = QuotaTracker(cfg, store)
    cooldowns = Cooldowns(cfg)
    router = Router(cfg, client or LiteLLMClient(), quota, cooldowns=cooldowns)
    stt = SttRegistry(cfg, quota, cooldowns, **({"factory": stt_factory} if stt_factory else {}))
    meetings = meetings or InMemoryMeetingStore()
    return Services(cfg, quota, router, stt, meetings, SessionManager(stt, meetings))


_services: Services | None = None


def services() -> Services:
    global _services
    if _services is None:
        _services = build_services()
    return _services


def set_services(s: Services | None) -> None:
    global _services
    _services = s
