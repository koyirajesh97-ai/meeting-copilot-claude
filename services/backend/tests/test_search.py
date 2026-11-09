"""Search and "Ask my meetings": chunking, embeddings, hybrid index, visibility, cited answers."""

from __future__ import annotations

import asyncio
import json
import uuid

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import issue_token
from app.main import app
from app.meetings.pg import PostgresStore
from app.meetings.store import InMemoryMeetingStore, Meeting, Segment, new_id
from app.providers.embeddings import DIMS, CloudflareEmbedder, EmbeddingRouter, FakeEmbedder
from app.router import DataPolicyError, InMemoryQuotaStore, RouterConfig
from app.router.client import FakeClient
from app.router.fake_responses import fake_responder
from app.router.quota import Cooldowns, QuotaTracker
from app.search.chunking import summary_chunks, transcript_chunks
from app.search.index import InMemoryIndex, PostgresIndex
from app.services import build_services, set_services
from app.summaries.schema import Decision, Summary

REVIEW = [
    ("spk_0", "This change adds exponential backoff to the payment retries."),
    ("spk_1", "We decided to keep the retry limit at three to protect the bank API."),
    ("me", "I'll update the runbook with the rollback steps."),
]
STANDUP = [
    ("me", "Yesterday I finished the certificate renewal for the payments cluster."),
    ("me", "Today I'm moving the prod deploy to Thursday."),
    ("spk_0", "I'm blocked on VPN access for the staging box."),
]


def segs(mid: str, lines, step=60_000) -> list[Segment]:
    return [
        Segment(
            mid,
            f"seg_{i}",
            "mic" if w == "me" else "system",
            w,
            t,
            i * step,
            i * step + 5000,
            "fake",
        )
        for i, (w, t) in enumerate(lines)
    ]


def test_transcript_chunks_keep_speakers_times_and_overlap() -> None:
    lines = [("spk_0", f"line {i} " + "word " * 60) for i in range(30)]
    chunks = transcript_chunks(segs("m", lines, step=1000), {"spk_0": "Priya"})
    assert len(chunks) > 3
    assert all(len(c.text) <= 400 * 4 + 400 for c in chunks)
    assert chunks[0].text.startswith("[00:00] Priya: line 0")
    assert chunks[1].start_ms > 0 and chunks[1].source_id.startswith("seg_")
    # ~50 tokens of overlap: the line that ends one chunk also starts the next.
    assert chunks[0].text.splitlines()[-1] == chunks[1].text.splitlines()[0]


def test_summary_chunks_cover_the_useful_parts() -> None:
    s = Summary(
        overview="Retry review.",
        decisions=[Decision(text="Keep the limit at three")],
        open_questions=["Timeouts?"],
    )
    assert [c.source_id for c in summary_chunks(s)] == ["overview", "decisions", "open_questions"]
    assert all(c.source_type == "summary" and c.start_ms is None for c in summary_chunks(s))


async def test_fake_embeddings_are_normalized_and_meaningful() -> None:
    a, b, c = await FakeEmbedder().embed(
        ["retry limit decision", "the retry limit we decided", "VPN access for staging"]
    )
    assert len(a) == DIMS and abs(sum(x * x for x in a) - 1) < 1e-6
    dot = lambda x, y: sum(p * q for p, q in zip(x, y, strict=True))  # noqa: E731
    assert dot(a, b) > dot(a, c)


def embed_cfg(**providers) -> RouterConfig:
    return RouterConfig.model_validate(
        {
            "tasks": {"embed": ["local/m", "cloudflare/m", "risky/m"]},
            "providers": {
                "local": {"kind": "embed", "trains_on_data": False},
                "cloudflare": {"kind": "embed", "trains_on_data": False},
                "risky": {"kind": "embed"},
            }
            | providers,
        }
    )


class Down:
    name = "down"

    def available(self) -> bool:
        return False

    async def embed(self, texts):  # pragma: no cover
        raise AssertionError


async def test_embedding_router_falls_back_and_respects_data_policy() -> None:
    cfg = embed_cfg()
    adapters = {"local/m": Down(), "cloudflare/m": FakeEmbedder(), "risky/m": FakeEmbedder()}
    r = EmbeddingRouter(
        cfg,
        QuotaTracker(cfg, InMemoryQuotaStore()),
        Cooldowns(cfg),
        factory=lambda d, _c: adapters[d.id],
    )
    _, provider = await r.embed(["hello"], "meeting")
    assert provider == "cloudflare/m"
    only_risky = RouterConfig.model_validate(
        {"tasks": {"embed": ["risky/m"]}, "providers": {"risky": {"kind": "embed"}}}
    )
    r2 = EmbeddingRouter(
        only_risky,
        QuotaTracker(only_risky, InMemoryQuotaStore()),
        Cooldowns(only_risky),
        factory=lambda d, _c: adapters[d.id],
    )
    with pytest.raises(DataPolicyError):
        await r2.embed(["meeting text"], "meeting")
    assert (await r2.embed(["fixture"], "test"))[1] == "risky/m"


async def test_cloudflare_embedder_calls_workers_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CF_T", "tok")
    monkeypatch.setenv("CF_A", "acct")
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"], seen["body"] = (
            str(req.url),
            req.headers["authorization"],
            json.loads(req.content),
        )
        return httpx.Response(200, json={"result": {"data": [[3.0, 4.0] + [0.0] * (DIMS - 2)]}})

    e = CloudflareEmbedder(
        "bge-small-en-v1.5", "CF_T", "CF_A", transport=httpx.MockTransport(handler)
    )
    assert e.available()
    [v] = await e.embed(["hi"])
    assert seen["url"].endswith("/accounts/acct/ai/run/@cf/baai/bge-small-en-v1.5")
    assert seen["auth"] == "Bearer tok" and seen["body"] == {"text": ["hi"]}
    assert v[:2] == pytest.approx([0.6, 0.8])


# ---------- through the API ----------


@pytest.fixture
def env():
    store = InMemoryMeetingStore()
    s = build_services(
        client=FakeClient(responder=fake_responder), store=InMemoryQuotaStore(), meetings=store
    )
    set_services(s)
    with TestClient(app) as client:
        yield s, store, client
    set_services(None)


def h(user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(user)}"}


def record(env, owner: str, title: str, mtype: str, lines, **kw) -> str:
    s, store, client = env
    m = Meeting(
        id=new_id(),
        owner_id=owner,
        type=mtype,
        title=title,
        mode="cloud",
        visibility=kw.get("visibility", "private"),
        project_id=kw.get("project_id"),
    )

    async def seed() -> None:
        await store.create(m)
        for sg in segs(m.id, lines):
            await store.add_segment(sg)

    asyncio.run(seed())
    assert client.post(f"/meetings/{m.id}/end", headers=h(owner)).status_code == 204
    for _ in range(200):  # wait for the summary job, which indexes the meeting
        if client.get(f"/meetings/{m.id}/summary", headers=h(owner)).json()["status"] == "ready":
            break
        asyncio.run(asyncio.sleep(0.01))
    return m.id


def test_ask_what_did_we_decide_returns_the_right_meeting_with_a_working_citation(env) -> None:
    review = record(env, "u1", "Retry design review", "review", REVIEW)
    record(env, "u1", "Payments standup", "standup", STANDUP)
    _, _, client = env
    r = client.post(
        "/ask", json={"question": "What did we decide about the retry limit?"}, headers=h("u1")
    ).json()
    assert r["found"] is True
    assert "retry limit at three" in r["answer"]
    first = r["citations"][0]
    assert first["meeting_id"] == review and first["title"] == "Retry design review"
    assert "retry limit at three" in first["quote"]
    # The citation points at the moment it was said, so the app can open the meeting there.
    assert first["start_ms"] is None or first["start_ms"] <= 60_000
    detail = client.get(f"/meetings/{first['meeting_id']}", headers=h("u1")).json()
    if first["start_ms"] is not None:
        said = [s for s in detail["transcript"] if s["start_ms"] >= first["start_ms"]]
        assert any("retry limit" in s["text"] for s in said)


def test_ask_says_so_when_nothing_relevant_exists(env) -> None:
    record(env, "u1", "Payments standup", "standup", STANDUP)
    _, _, client = env
    r = client.post(
        "/ask", json={"question": "What is our holiday party budget?"}, headers=h("u1")
    ).json()
    assert r == {
        "answer": "I couldn't find that in your meetings.",
        "found": False,
        "citations": [],
        "provider": r["provider"],
    }
    assert (
        client.post("/ask", json={"question": "anything"}, headers=h("nobody")).json()["found"]
        is False
    )


def test_made_up_citations_are_dropped(env) -> None:
    s, _, client = env
    record(env, "u1", "Retry design review", "review", REVIEW)
    s.router.client.script = {
        "mistral/mistral-small-latest": [
            '{"answer": "Yes [c99]", "citations": ["c99"], "found": true}'
        ]
    }
    r = client.post("/ask", json={"question": "retry limit decided"}, headers=h("u1")).json()
    assert r["found"] is False and r["citations"] == []


def test_search_finds_text_and_respects_who_may_see_it(env) -> None:
    s, _, client = env
    record(env, "u1", "Retry design review", "review", REVIEW)
    shared = record(
        env,
        "u2",
        "Shared infra sync",
        "planning",
        [("me", "The VPN migration starts Monday.")],
        visibility="project",
        project_id="p1",
    )
    hits = client.get("/search", params={"q": "retry limit"}, headers=h("u1")).json()
    assert hits and hits[0]["title"] == "Retry design review"

    def ids(q, u):
        return {
            x["meeting_id"] for x in client.get("/search", params={"q": q}, headers=h(u)).json()
        }

    assert shared not in ids("VPN migration", "u1")  # not a project member yet
    assert client.get("/search", params={"q": "retry limit"}, headers=h("u3")).json() == []
    s.search.index.members["p1"] = {"u1", "u2"}  # u1 joins the project
    assert shared in ids("VPN migration", "u1")
    assert client.get("/search", params={"q": "  "}, headers=h("u1")).json() == []


async def test_postgres_hybrid_search_and_visibility(pg_dsn: str) -> None:
    owner, member, outsider = (str(uuid.UUID(int=i)) for i in (11, 12, 13))
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        for u in (owner, member, outsider):
            c.execute("insert into auth.users (id) values (%s)", (u,))
            c.execute("insert into public.users (id) values (%s)", (u,))
        pid = str(
            c.execute(
                "insert into projects (name, created_by) values ('P', %s) returning id", (owner,)
            ).fetchone()[0]
        )
        c.execute("insert into project_members values (%s, %s, 'member')", (pid, member))
    store = PostgresStore(pg_dsn)
    index = PostgresIndex(store)
    emb = FakeEmbedder()
    meetings = {
        "private": Meeting(new_id(), owner, "review", "Private review", "cloud", "private", pid),
        "shared": Meeting(new_id(), owner, "planning", "Shared planning", "cloud", "project", pid),
    }
    for key, m in meetings.items():
        await store.create(m)
        lines = (
            REVIEW
            if key == "private"
            else [("me", "The VPN migration starts Monday for the staging box.")]
        )
        chunks = transcript_chunks(segs(m.id, lines), {})
        await index.replace_meeting(m, chunks, await emb.embed([c.text for c in chunks]))

    async def find(user: str, q: str) -> list[str]:
        [v] = await emb.embed([q])
        return [h.title for h in await index.search(user, q, v)]

    assert (await find(owner, "retry limit"))[0] == "Private review"
    assert "Private review" not in await find(member, "retry limit")  # private to its owner
    assert "Shared planning" in await find(member, "VPN migration")
    assert await find(outsider, "VPN migration") == []
    # Re-indexing replaces, never duplicates.
    m = meetings["shared"]
    chunks = transcript_chunks(segs(m.id, [("me", "Only this line now.")]), {})
    await index.replace_meeting(m, chunks, await emb.embed([c.text for c in chunks]))
    with psycopg.connect(pg_dsn) as c:
        assert (
            c.execute("select count(*) from chunks where meeting_id = %s", (m.id,)).fetchone()[0]
            == 1
        )
    await store.close()


def test_in_memory_index_ranks_keyword_matches_first() -> None:
    async def go() -> list[str]:
        idx, emb = InMemoryIndex(), FakeEmbedder()
        for title, lines in [("A", REVIEW), ("B", STANDUP)]:
            m = Meeting(new_id(), "u", "custom", title, "cloud", "private")
            ch = transcript_chunks(segs(m.id, lines), {})
            await idx.replace_meeting(m, ch, await emb.embed([c.text for c in ch]))
        [v] = await emb.embed(["certificate renewal"])
        return [h.title for h in await idx.search("u", "certificate renewal", v)]

    assert asyncio.run(go())[0] == "B"


def test_without_an_embedding_model_search_falls_back_to_keywords() -> None:
    """No embedding provider (e.g. the model can't be loaded): indexing and search still work."""
    store = InMemoryMeetingStore()
    s = build_services(
        client=FakeClient(responder=fake_responder),
        store=InMemoryQuotaStore(),
        meetings=store,
        embed_factory=lambda _d, _c: None,
    )
    set_services(s)
    try:
        with TestClient(app) as client:
            mid = record((s, store, client), "u1", "Daily standup", "standup", STANDUP)
            r = client.get("/search", params={"q": "certificate renewal"}, headers=h("u1"))
            assert r.status_code == 200
            hits = r.json()
            assert hits and hits[0]["meeting_id"] == mid
    finally:
        set_services(None)


async def test_postgres_keyword_only_chunks_and_queries(pg_dsn: str) -> None:
    owner = str(uuid.UUID(int=21))
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        c.execute("insert into auth.users (id) values (%s)", (owner,))
        c.execute("insert into public.users (id) values (%s)", (owner,))
    store = PostgresStore(pg_dsn)
    index = PostgresIndex(store)
    m = Meeting(new_id(), owner, "standup", "No vectors", "cloud", "private")
    await store.create(m)
    chunks = transcript_chunks(segs(m.id, STANDUP), {})
    await index.replace_meeting(m, chunks, [None] * len(chunks))  # stored with a NULL embedding
    assert [h.title for h in await index.search(owner, "certificate renewal", None)] == [
        "No vectors"
    ]
    # A query with a vector still finds keyword-only chunks.
    [v] = await FakeEmbedder().embed(["certificate renewal"])
    assert (await index.search(owner, "certificate renewal", v))[0].title == "No vectors"
    await store.close()


async def test_a_model_that_fails_to_load_is_not_retried_for_a_while(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.providers.embeddings as emb

    calls = 0

    def broken(_model: str):
        nonlocal calls
        calls += 1
        raise ValueError("Could not load model from any source")

    broken.cache_info = lambda: type("I", (), {"currsize": 0})()  # never loaded
    monkeypatch.setattr(emb, "_fastembed_model", broken)
    monkeypatch.setitem(
        __import__("sys").modules, "fastembed", type(__import__("sys"))("fastembed")
    )
    e = emb.FastEmbedder()
    assert e.available() is True
    with pytest.raises(ValueError):
        await e.embed(["hello"])
    assert calls == 1 and e.available() is False  # skipped (keyword search) until the retry time
    monkeypatch.setattr(emb, "LOAD_RETRY_S", 0.0)
    assert e.available() is True
