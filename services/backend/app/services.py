"""The app's shared services (router, STT registry, quota), built once from config.

Tests replace them with `set_services(...)` to inject fakes.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from app.jobs.summary import SummaryJobs
from app.live.follow_ups import follow_up_drafter
from app.live.help import live_help_factory
from app.live.store import InMemoryCards, PostgresCards
from app.meetings.speakers import InMemorySpeakers, PostgresSpeakers
from app.meetings.store import InMemoryMeetingStore, MeetingStore
from app.privacy.store import InMemoryPrivacy, PostgresPrivacy
from app.profiles.store import InMemoryProfiles, PostgresProfiles
from app.projects.documents import InMemoryDocuments, PostgresDocuments, default_blobs
from app.projects.store import InMemoryProjects, PostgresProjects
from app.providers.embeddings import EmbeddingRouter, FakeEmbedder
from app.providers.speaker_id import FakeSpeakerEmbedder, SpeakerIdRouter
from app.providers.stt.base import FakeSttAdapter
from app.realtime.manager import SessionManager
from app.realtime.speakers import speaker_plugin_factory
from app.router.client import CompletionClient, FakeClient, LiteLLMClient
from app.router.config import Deployment, RouterConfig, load_config
from app.router.quota import Cooldowns, InMemoryQuotaStore, QuotaStore, QuotaTracker
from app.router.router import Router
from app.router.stt import SttRegistry
from app.search.index import InMemoryIndex, PostgresIndex
from app.search.service import SearchService
from app.standup.service import StandupService
from app.standup.store import InMemoryStandups, PostgresStandups


def fake_providers_enabled() -> bool:
    return os.environ.get("COPILOT_FAKE_PROVIDERS") == "1"


FAKE_LINES = [
    ("Morning everyone, let's start the standup.", "0"),
    ("Yesterday I finished the certificate renewal for the payments cluster.", "0"),
    ("Today I'm moving the prod deploy to Thursday.", "0"),
    ("No blockers on my side.", "0"),
]


def fake_stt_factory(d: Deployment, _cfg: RouterConfig) -> FakeSttAdapter:
    return FakeSttAdapter(d.id, FAKE_LINES * 50, seconds_per_line=2.0)


@dataclass
class Services:
    config: RouterConfig
    quota: QuotaTracker
    router: Router
    stt: SttRegistry
    meetings: MeetingStore
    sessions: SessionManager
    summaries: SummaryJobs
    search: SearchService
    speakers: InMemorySpeakers | PostgresSpeakers
    speaker_id: SpeakerIdRouter
    profiles: InMemoryProfiles | PostgresProfiles
    cards: InMemoryCards | PostgresCards
    standups: InMemoryStandups | PostgresStandups
    standup: StandupService
    projects: InMemoryProjects | PostgresProjects
    documents: InMemoryDocuments | PostgresDocuments
    blobs: object
    privacy: InMemoryPrivacy | PostgresPrivacy | None = None
    #: For tests: an httpx transport used when fetching project links.
    link_transport: object = None


def build_services(
    config: RouterConfig | None = None,
    client: CompletionClient | None = None,
    store: QuotaStore | None = None,
    stt_factory=None,
    meetings: MeetingStore | None = None,
    embed_factory=None,
    speaker_factory=None,
) -> Services:
    cfg = config or load_config()
    if fake_providers_enabled():
        # Offline dev and end-to-end tests: every provider is a Fake (no network, no keys).
        from app.router.fake_responses import fake_responder

        client = client or FakeClient(responder=fake_responder)
        stt_factory = stt_factory or fake_stt_factory
        embed_factory = embed_factory or (lambda _d, _c: FakeEmbedder())
        speaker_factory = speaker_factory or (lambda _d, _c: FakeSpeakerEmbedder())
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
    if meetings is None:
        dsn = os.environ.get("DATABASE_URL")
        if dsn:
            from app.meetings.pg import PostgresStore

            meetings = PostgresStore(dsn)
        else:
            meetings = InMemoryMeetingStore()
    sessions = SessionManager(stt, meetings)
    summaries = SummaryJobs(meetings, router, notify=sessions.notify_summary)
    embedder = EmbeddingRouter(
        cfg, quota, cooldowns, **({"factory": embed_factory} if embed_factory else {})
    )
    pg = hasattr(meetings, "connection")
    projects = PostgresProjects(meetings) if pg else InMemoryProjects()

    async def is_member(project_id: str, user_id: str) -> bool:
        return await projects.role(project_id, user_id) is not None

    index = PostgresIndex(meetings) if pg else InMemoryIndex(is_member)
    search = SearchService(index, embedder, router, meetings)
    # Index each meeting once its summary is saved (and again after a regenerate).
    summaries.after_ready.append(search.index_meeting)
    speakers = PostgresSpeakers(meetings) if hasattr(meetings, "connection") else InMemorySpeakers()
    speaker_id = SpeakerIdRouter(cfg, **({"factory": speaker_factory} if speaker_factory else {}))
    sessions.plugin_factories.append(speaker_plugin_factory(speakers, speaker_id, cfg.speaker_id))
    profiles = PostgresProfiles(meetings) if pg else InMemoryProfiles()
    privacy = PostgresPrivacy(meetings) if pg else InMemoryPrivacy(meetings)

    async def opted_in(user_id: str) -> bool:
        try:
            return (await privacy.get(user_id)).allow_test_providers
        except Exception:
            return False  # unknown means no

    router.opt_in = opted_in
    cards = PostgresCards(meetings) if pg else InMemoryCards()
    standups = PostgresStandups(meetings) if pg else InMemoryStandups()
    standup = StandupService(standups, meetings, router, profiles)
    sessions.plugin_factories.append(
        live_help_factory(router, search, cards, profiles, cfg.live_help, standup)
    )
    # After the summary (and search index): draft replies for "I'll follow up" items.
    summaries.after_ready.append(follow_up_drafter(meetings, router, search, profiles))
    return Services(
        cfg,
        quota,
        router,
        stt,
        meetings,
        sessions,
        summaries,
        search,
        speakers,
        speaker_id,
        profiles,
        cards,
        standups,
        standup,
        projects,
        PostgresDocuments(meetings) if pg else InMemoryDocuments(),
        default_blobs(),
        privacy=privacy,
    )


_services: Services | None = None


def services() -> Services:
    global _services
    if _services is None:
        _services = build_services()
    return _services


def set_services(s: Services | None) -> None:
    global _services
    _services = s
