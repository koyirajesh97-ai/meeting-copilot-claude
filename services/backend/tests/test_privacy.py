"""Privacy modes and consent tools (Prompt 14)."""

from __future__ import annotations

import io
import json
import re
import socket
import time
import uuid
import zipfile

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import issue_token
from app.main import app
from app.meetings.pg import PostgresStore
from app.meetings.store import (
    ActionItemRecord,
    ConsentEvent,
    InMemoryMeetingStore,
    Meeting,
    Segment,
    new_id,
)
from app.privacy.service import sweep_retention
from app.privacy.store import PostgresPrivacy, PrivacySettings
from app.providers.embeddings import FakeEmbedder, default_factory
from app.providers.stt.base import FakeSttAdapter
from app.router import DataPolicyError, InMemoryQuotaStore, load_config
from app.router.client import LiteLLMClient
from app.router.config import RouterConfig
from app.router.stt import default_adapter_factory
from app.services import build_services, set_services

LINES = [
    ("Morning all, quick sync on the payments deploy.", "0"),
    ("Sai, when is the prod deploy happening?", "0"),
    ("We moved it to Thursday after the cert renewal.", "0"),
]


def h(user: str = "u1") -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(user)}"}


@pytest.fixture
def env():
    store = InMemoryMeetingStore()
    s = build_services(
        config=load_config(),
        store=InMemoryQuotaStore(),
        meetings=store,
        stt_factory=lambda d, _c: FakeSttAdapter(d.id, LINES, seconds_per_line=1.0),
    )
    set_services(s)
    with TestClient(app) as client:
        yield s, store, client
    set_services(None)


def _stream(
    client, m: dict, frames: int = 3 * 50 + 5, controls: list[dict] | None = None
) -> list[dict]:
    with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
        events = [ws.receive_json()]  # meeting.started
        for c in controls or []:
            ws.send_text(json.dumps({"type": "control", **c}))
        for _ in range(frames):
            ws.send_bytes(b"\x01" + b"\x00" * 640)
        finals = 0
        while finals < len(LINES):
            e = ws.receive_json()
            events.append(e)
            finals += e["type"] == "transcript.final"
        ws.send_text('{"type": "ping"}')
    return events


def _wait_summary(client, mid: str, user: str = "u1") -> str:
    status = "pending"
    for _ in range(500):
        status = client.get(f"/meetings/{mid}/summary", headers=h(user)).json()["status"]
        if status not in ("pending", "none"):
            break
        time.sleep(0.01)
    return status


# ---------- Local-only: nothing leaves this machine ----------


class NetworkGuard:
    """Refuses (and records) every DNS lookup or connection that isn't to localhost."""

    LOCAL = {"localhost", "127.0.0.1", "::1", "testserver"}

    def __init__(self, monkeypatch) -> None:
        self.blocked: list[str] = []
        real_getaddrinfo = socket.getaddrinfo
        real_connect = socket.socket.connect
        real_connect_ex = socket.socket.connect_ex

        def is_local(host) -> bool:
            h = str(host).strip("[]").lower()
            return h in self.LOCAL or re.fullmatch(r"127\.\d+\.\d+\.\d+", h) is not None

        def getaddrinfo(host, *a, **k):
            if host is not None and not is_local(host):
                self.blocked.append(f"dns {host}")
                raise OSError(f"network guard: lookup of {host} blocked")
            return real_getaddrinfo(host, *a, **k)

        def check(addr) -> None:
            if isinstance(addr, tuple) and not is_local(addr[0]):
                self.blocked.append(f"connect {addr[0]}")
                raise OSError(f"network guard: connection to {addr[0]} blocked")

        def connect(sock, addr):
            check(addr)
            return real_connect(sock, addr)

        def connect_ex(sock, addr):
            check(addr)
            return real_connect_ex(sock, addr)

        monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
        monkeypatch.setattr(socket.socket, "connect", connect)
        monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)


@pytest.fixture
def real_providers(monkeypatch):
    """Real provider clients with (fake) keys: anything not Local-only would try the network."""
    for k in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"):
        monkeypatch.delenv(k, raising=False)  # connect directly, so the guard sees every host
    for k in (
        "GROQ_API_KEY",
        "MISTRAL_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "DEEPGRAM_API_KEY",
        "GLADIA_API_KEY",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
    ):
        monkeypatch.setenv(k, "x")
    opened: list[str] = []

    def stt_factory(d, cfg):
        opened.append(d.id)
        if cfg.provider(d.provider).local:  # stands in for faster-whisper on this machine
            return FakeSttAdapter(d.id, LINES, seconds_per_line=1.0)
        return default_adapter_factory(d, cfg)

    def embed_factory(d, cfg):
        return FakeEmbedder() if cfg.provider(d.provider).local else default_factory(d, cfg)

    s = build_services(
        config=load_config(),
        client=LiteLLMClient(),
        store=InMemoryQuotaStore(),
        meetings=InMemoryMeetingStore(),
        stt_factory=stt_factory,
        embed_factory=embed_factory,
    )
    set_services(s)
    yield s, opened
    set_services(None)


def test_local_only_meeting_never_leaves_localhost(real_providers, monkeypatch) -> None:
    s, opened = real_providers
    guard = NetworkGuard(monkeypatch)
    with TestClient(app) as client:
        client.put("/me/profile", json={"name": "Sai", "title": "DevOps/SRE"}, headers=h())
        m = client.post(
            "/meetings",
            json={"type": "standup", "title": "Local sync", "mode": "local"},
            headers=h(),
        ).json()
        events = _stream(client, m, controls=[{"action": "catch_up", "minutes": 2}])
        started = next(e for e in events if e["type"] == "meeting.started")
        assert all(p.startswith("local/") for p in started["providers"].values()), started
        assert client.post(f"/meetings/{m['meeting_id']}/end", headers=h()).status_code == 204
        # The summary may only use Ollama on localhost (not running here, so it fails cleanly).
        assert _wait_summary(client, m["meeting_id"]) == "failed"
        assert client.get("/search", params={"q": "deploy"}, headers=h()).status_code == 200
    assert all(o.startswith("local/") for o in opened), opened
    assert guard.blocked == [], guard.blocked


def test_the_network_guard_catches_cloud_calls(real_providers, monkeypatch) -> None:
    """Sanity check: the same setup outside Local-only does try to leave localhost."""
    s, _ = real_providers
    guard = NetworkGuard(monkeypatch)
    from app.router import NoProviderAvailable

    with TestClient(app) as client, pytest.raises(NoProviderAvailable):
        client.portal.call(
            lambda: s.router.complete("detect", [{"role": "user", "content": "hi"}], "test")
        )
    assert any("groq" in b for b in guard.blocked), guard.blocked


def test_local_only_router_skips_cloud_providers_and_says_why() -> None:
    from app.router import FakeClient, NoProviderAvailable, Router
    from app.router.quota import QuotaTracker

    cfg = load_config()
    client = FakeClient()
    r = Router(cfg, client, QuotaTracker(cfg, InMemoryQuotaStore()))
    import asyncio

    out = asyncio.run(
        r.complete("card", [{"role": "user", "content": "x"}], "meeting", local_only=True)
    )
    assert out.provider == "ollama/llama3.2:3b" and client.calls == ["ollama/llama3.2:3b"]
    only_cloud = RouterConfig.model_validate(
        {**cfg.model_dump(mode="python"), "tasks": {"card": ["groq/openai/gpt-oss-20b"]}}
    )
    r2 = Router(only_cloud, client, QuotaTracker(only_cloud, InMemoryQuotaStore()))
    with pytest.raises(NoProviderAvailable, match="install Ollama"):
        asyncio.run(
            r2.complete("card", [{"role": "user", "content": "x"}], "meeting", local_only=True)
        )


def test_loopback_check() -> None:
    from app.router.config import is_loopback_url

    assert all(
        map(is_loopback_url, ["http://127.0.0.1:11434", "http://localhost", "http://[::1]:8000"])
    )
    assert not any(
        map(
            is_loopback_url, ["http://127.example.com", "http://localhost.evil.com", "https://x.io"]
        )
    )


def test_local_providers_must_be_on_localhost() -> None:
    cfg = load_config().model_dump(mode="python")
    cfg["providers"]["ollama"]["base_url"] = "https://ollama.example.com/v1"
    with pytest.raises(ValueError, match="localhost"):
        RouterConfig.model_validate(cfg)


def test_local_only_needs_a_local_database(env, monkeypatch) -> None:
    _, _, client = env
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.example.supabase.co:5432/postgres")
    r = client.post(
        "/meetings", json={"type": "custom", "title": "x", "mode": "local"}, headers=h()
    )
    assert r.status_code == 409 and "database" in r.json()["detail"]
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:54322/postgres")
    assert (
        client.post(
            "/meetings", json={"type": "custom", "title": "x", "mode": "local"}, headers=h()
        ).status_code
        == 201
    )


def test_local_hits_never_reach_a_cloud_model(env) -> None:
    s, store, client = env
    for mode, title in (("local", "Local secret"), ("cloud", "Cloud notes")):
        m = Meeting(new_id(), "u1", "custom", title, mode, "private")
        client.portal.call(store.create, m)
        client.portal.call(
            store.add_segment,
            Segment(m.id, "seg_0", "mic", "me", "the vault code is in the runbook", 0, 900, "x"),
        )
        client.portal.call(s.search.index_meeting, m)
    titles = {
        x["title"] for x in client.get("/search", params={"q": "vault code"}, headers=h()).json()
    }
    assert titles == {"Local secret", "Cloud notes"}  # search itself runs here and shows both
    sent: list[str] = []
    s.router.client.responder = lambda task, msgs, j: (
        sent.append(msgs[-1]["content"]),
        '{"answer": "", "found": false}',
    )[1]
    client.post("/ask", json={"question": "where is the vault code?"}, headers=h())
    assert sent and "Cloud notes" in sent[0] and "Local secret" not in sent[0]


# ---------- Live-only ----------


def test_live_only_keeps_nothing(env) -> None:
    s, store, client = env
    m = client.post(
        "/meetings",
        json={"type": "custom", "title": "Off the record", "mode": "live-only"},
        headers=h(),
    ).json()
    events = _stream(client, m, controls=[{"action": "pause"}, {"action": "resume"}])
    assert [e for e in events if e["type"] == "transcript.final"]  # live help still works
    mid = m["meeting_id"]
    assert client.portal.call(store.segments, mid) == []
    assert client.portal.call(store.consent_events, mid) == []
    assert client.post(
        f"/meetings/{mid}/consent", json={"kind": "announced"}, headers=h()
    ).json() == {"logged": False}
    client.post(f"/meetings/{mid}/end", headers=h())
    assert client.portal.call(store.get, mid) is None
    assert client.get(f"/meetings/{mid}", headers=h()).status_code == 404
    assert not s.sessions.watchable(mid)
    assert client.portal.call(s.cards.for_meeting, mid) == []


def test_abandoned_live_only_meetings_are_swept(env) -> None:
    s, store, client = env
    old = Meeting(
        new_id(),
        "u1",
        "custom",
        "left open",
        "live-only",
        "private",
        started_at=time.time() - 13 * 3600,
    )
    client.portal.call(store.create, old)
    assert client.portal.call(sweep_retention, s) == 1
    assert client.portal.call(store.get, old.id) is None


# ---------- consent ----------


def test_announce_pause_and_resume_are_logged(env) -> None:
    _, store, client = env
    m = client.post(
        "/meetings", json={"type": "review", "title": "Consent check"}, headers=h()
    ).json()
    mid = m["meeting_id"]
    assert client.post(
        f"/meetings/{mid}/consent",
        json={"kind": "announced", "note": "pasted in chat"},
        headers=h(),
    ).json() == {"logged": True}
    _stream(client, m, controls=[{"action": "pause"}, {"action": "resume"}])
    log = client.get(f"/meetings/{mid}/consent", headers=h()).json()
    assert [e["kind"] for e in log] == ["announced", "paused", "resumed"]
    assert log[0]["note"] == "pasted in chat"
    assert client.get(f"/meetings/{mid}/consent", headers=h("u2")).status_code == 404
    assert (
        client.post(
            f"/meetings/{mid}/consent", json={"kind": "announced"}, headers=h("u2")
        ).status_code
        == 404
    )


# ---------- providers and the opt-in ----------


def test_test_only_providers_need_the_settings_opt_in(env) -> None:
    s, _, client = env
    assert client.get("/me/privacy", headers=h()).json()["allow_test_providers"] is False
    providers = {p["name"]: p for p in client.get("/providers", headers=h()).json()}
    assert (
        providers["gemini"]["trains_on_data"] is True
        and not providers["gemini"]["meeting_data_allowed"]
    )
    assert providers["openrouter"]["trains_on_data"] == "unknown"
    assert providers["groq"]["meeting_data_allowed"] and "card" in providers["groq"]["tasks"]
    assert providers["ollama"]["local"] and providers["local"]["local"]

    cfg = s.config.model_dump(mode="python")
    cfg["tasks"] = {**cfg["tasks"], "summary": ["gemini/gemini-flash"]}
    s.router.config = RouterConfig.model_validate(cfg)
    msgs = [{"role": "user", "content": "x"}]
    with pytest.raises(DataPolicyError):
        client.portal.call(lambda: s.router.complete("summary", msgs, "meeting", owner_id="u1"))
    settings = client.get("/me/privacy", headers=h()).json()
    client.put("/me/privacy", json={**settings, "allow_test_providers": True}, headers=h())
    out = client.portal.call(lambda: s.router.complete("summary", msgs, "meeting", owner_id="u1"))
    assert out.provider == "gemini/gemini-flash"
    # Only for the user who opted in.
    with pytest.raises(DataPolicyError):
        client.portal.call(lambda: s.router.complete("summary", msgs, "meeting", owner_id="u2"))
    assert {p["name"]: p for p in client.get("/providers", headers=h()).json()}["gemini"][
        "meeting_data_allowed"
    ]


def test_privacy_settings_are_validated(env) -> None:
    _, _, client = env
    assert client.put("/me/privacy", json={"retention_days": 0}, headers=h()).status_code == 422
    out = client.put(
        "/me/privacy", json={"retention_days": 30, "consent_message": "Recording, OK?"}, headers=h()
    ).json()
    assert out == {
        "allow_test_providers": False,
        "retention_days": 30,
        "consent_message": "Recording, OK?",
    }


# ---------- delete, retention, export, delete account ----------


def _recorded_meeting(client) -> str:
    client.put("/me/profile", json={"name": "Sai", "title": "DevOps/SRE"}, headers=h())
    m = client.post(
        "/meetings", json={"type": "review", "title": "Deploy review"}, headers=h()
    ).json()
    _stream(client, m)
    client.post(f"/meetings/{m['meeting_id']}/end", headers=h())
    assert _wait_summary(client, m["meeting_id"]) == "ready"
    return m["meeting_id"]


def test_delete_meeting_removes_everything(env) -> None:
    s, store, client = env
    mid = _recorded_meeting(client)
    client.post(f"/meetings/{mid}/consent", json={"kind": "announced"}, headers=h())
    assert client.portal.call(store.segments, mid)
    assert client.get("/search", params={"q": "Thursday deploy"}, headers=h()).json()
    assert client.delete(f"/meetings/{mid}", headers=h("u2")).status_code == 404
    assert client.delete(f"/meetings/{mid}", headers=h()).status_code == 204
    assert client.get(f"/meetings/{mid}", headers=h()).status_code == 404
    assert client.portal.call(store.segments, mid) == []
    assert client.portal.call(store.latest_summary, mid) is None
    assert client.portal.call(store.action_items, mid) == []
    assert client.portal.call(store.consent_events, mid) == []
    assert client.portal.call(s.cards.for_meeting, mid) == []
    assert [
        x
        for x in client.get("/search", params={"q": "Thursday deploy"}, headers=h()).json()
        if x["meeting_id"] == mid
    ] == []


def test_retention_deletes_old_meetings_only(env) -> None:
    s, store, client = env
    old = Meeting(
        new_id(), "u1", "custom", "old", "cloud", "private", started_at=time.time() - 40 * 86400
    )
    new = Meeting(
        new_id(), "u1", "custom", "new", "cloud", "private", started_at=time.time() - 86400
    )
    other = Meeting(
        new_id(),
        "u2",
        "custom",
        "u2 keeps all",
        "cloud",
        "private",
        started_at=time.time() - 400 * 86400,
    )
    for m in (old, new, other):
        client.portal.call(store.create, m)
    assert (
        client.portal.call(sweep_retention, s) == 0
    )  # nothing is deleted until you choose a period
    client.put("/me/privacy", json={"retention_days": 30}, headers=h())
    assert client.portal.call(sweep_retention, s) == 1
    assert client.portal.call(store.get, old.id) is None
    assert client.portal.call(store.get, new.id) and client.portal.call(store.get, other.id)


def test_export_account_zip(env) -> None:
    _, _, client = env
    mid = _recorded_meeting(client)
    r = client.get("/me/export", headers=h())
    assert r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = z.namelist()
    md = next(n for n in names if n.endswith(".md") and n.startswith("meetings/"))
    js = next(n for n in names if n.endswith(".json") and n.startswith("meetings/"))
    assert "deploy-review" in md and z.read(md).decode().startswith("# Deploy review")
    data = json.loads(z.read(js))
    assert data["meeting"]["id"] == mid and data["transcript"] and data["summary"]
    account = json.loads(z.read("account.json"))
    assert account["profile"]["name"] == "Sai" and account["meetings"] == 1
    assert "voiceprint" not in z.read("account.json").decode()


def test_delete_account(env) -> None:
    s, store, client = env
    mid = _recorded_meeting(client)
    solo = client.post("/projects", json={"name": "Solo"}, headers=h()).json()
    team = client.post("/projects", json={"name": "Team"}, headers=h()).json()
    client.portal.call(s.projects.set_member, team["id"], "u2", "member")
    client.portal.call(s.projects.set_member, team["id"], "u3", "viewer")
    theirs = Meeting(new_id(), "u2", "custom", "u2's", "cloud", "project", project_id=team["id"])
    client.portal.call(store.create, theirs)
    assert client.post("/me/delete", json={"confirm": "yes"}, headers=h()).status_code == 422
    assert (
        client.post("/me/delete", json={"confirm": "delete my account"}, headers=h()).status_code
        == 204
    )
    assert client.portal.call(store.get, mid) is None
    assert client.portal.call(s.projects.get, solo["id"]) is None
    # The team keeps its project; the member became its owner.
    assert client.portal.call(s.projects.role, team["id"], "u2") == "owner"
    assert client.portal.call(s.projects.role, team["id"], "u1") is None
    assert client.portal.call(store.get, theirs.id) is not None
    assert client.get("/me/profile", headers=h()).json()["name"] == ""


# ---------- Postgres ----------


async def test_postgres_privacy(pg_dsn: str) -> None:
    uid = str(uuid.UUID(int=51))
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        c.execute("insert into auth.users (id) values (%s)", (uid,))
        c.execute("insert into public.users (id) values (%s)", (uid,))
    store = PostgresStore(pg_dsn)
    privacy = PostgresPrivacy(store)
    assert (await privacy.get(uid)).allow_test_providers is False
    await privacy.put(uid, PrivacySettings(allow_test_providers=True, retention_days=7))
    assert (await privacy.get(uid)).retention_days == 7
    old = Meeting(
        new_id(), uid, "custom", "old", "cloud", "private", started_at=time.time() - 8 * 86400
    )
    new = Meeting(new_id(), uid, "custom", "new", "cloud", "private")
    for m in (old, new):
        await store.create(m)
    await store.add_segment(Segment(old.id, "seg_0", "mic", "me", "hello", 0, 500, "x"))
    await store.add_action_item(old, ActionItemRecord(new_id(), old.id, "do it"))
    await store.add_consent_event(ConsentEvent(old.id, "announced", "chat"))
    assert [e.kind for e in await store.consent_events(old.id)] == ["announced"]
    assert [m.id for m in await store.expired_meetings(time.time())] == [old.id]
    await store.delete_meeting(old.id)
    assert await store.get(old.id) is None and await store.segments(old.id) == []
    assert await store.consent_events(old.id) == []
    await privacy.delete_user(uid)
    assert await store.get(new.id) is None  # cascades from the user
    await store.close()
