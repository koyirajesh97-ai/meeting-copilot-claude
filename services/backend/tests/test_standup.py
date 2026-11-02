"""Standup prep, the script card on your turn, and the pre-meeting brief."""

from __future__ import annotations

import time
import uuid
from datetime import date, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import issue_token
from app.live.help import is_my_turn
from app.main import app
from app.meetings.pg import PostgresStore
from app.meetings.store import (
    ActionItemRecord,
    DecisionRecord,
    InMemoryMeetingStore,
    Meeting,
    Segment,
    new_id,
    series_key,
)
from app.providers.stt.base import FakeSttAdapter
from app.router import InMemoryQuotaStore, load_config
from app.services import build_services, set_services
from app.standup.service import today
from app.standup.store import PostgresStandups, StandupEntry

NOTES = "finished OPS-142 cert renewal\ntoday moving the prod deploy to Thursday\nblocked on VPN access for staging"
STANDUP_LINES = [
    ("0", "Morning all, Priya you're up."),
    ("1", "Yesterday I fixed the login tests, today the retry PR."),
    ("0", "Thanks. Over to Sai."),
    ("0", "Sai, anything else?"),
]


@pytest.mark.parametrize(
    ("text", "mine"),
    [
        ("Over to Sai.", True),
        ("Sai, go ahead", True),
        ("Sai?", True),
        ("Next is SK", True),
        ("Your turn, Sai", True),
        ("Priya you're up.", False),
        ("I talked to Sai yesterday", False),
        ("Saito, go ahead", False),
    ],
)
def test_turn_detection(text: str, mine: bool) -> None:
    assert is_my_turn(text, ["Sai", "SK"]) is mine


def test_series_key_ignores_dates_and_numbers() -> None:
    assert (
        series_key("Payments standup 11/3")
        == series_key("Payments Standup - Thursday")
        == "payments standup"
    )


@pytest.fixture
def env():
    store = InMemoryMeetingStore()
    s = build_services(
        config=load_config(),
        store=InMemoryQuotaStore(),
        meetings=store,
        stt_factory=lambda d, _c: FakeSttAdapter(
            d.id, [(t, w) for w, t in STANDUP_LINES], seconds_per_line=1.0
        ),
    )
    set_services(s)
    with TestClient(app) as client:
        h = {"Authorization": f"Bearer {issue_token('u1')}"}
        client.put(
            "/me/profile", json={"name": "Sai", "aliases": ["SK"], "title": "DevOps/SRE"}, headers=h
        )
        yield s, store, client, h
    set_services(None)


def test_standup_prep_from_rough_notes(env) -> None:
    s, _, client, h = env
    yesterday = StandupEntry(
        "u1", None, today() - timedelta(days=1), "old", ["shipped OPS-100"], [], [], "x"
    )
    client.portal.call(s.standups.upsert, yesterday)
    assert client.get("/standup/today", headers=h).json() is None
    out = client.post("/standup", json={"notes": NOTES}, headers=h).json()
    assert out["date"] == today().isoformat() and out["notes"] == NOTES
    assert any("OPS-142" in x for x in out["done"])  # ticket IDs kept exactly
    assert any("prod deploy" in x for x in out["doing"])
    assert any("VPN" in x for x in out["blockers"])
    assert "OPS-142" in out["script"] and len(out["script"].split()) < 120
    edited = client.put(
        "/standup/today", json={**out, "script": "My edited script."}, headers=h
    ).json()
    assert edited["script"] == "My edited script." and edited["id"] == out["id"]
    assert client.get("/standup/today", headers=h).json()["script"] == "My edited script."
    assert (
        client.put(
            "/standup/today",
            json={"script": "x"},
            headers={"Authorization": f"Bearer {issue_token('u2')}"},
        ).status_code
        == 404
    )


def test_script_card_comes_up_on_my_turn_only(env) -> None:
    _, _, client, h = env
    client.post("/standup", json={"notes": NOTES}, headers=h)
    m = client.post(
        "/meetings", json={"type": "standup", "title": "Payments standup"}, headers=h
    ).json()
    with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
        ws.receive_json()
        for _ in range(len(STANDUP_LINES) * 50 + 5):
            ws.send_bytes(b"\x01" + b"\x00" * 640)
        events, finals = [], 0
        while finals < len(STANDUP_LINES):
            e = ws.receive_json()
            events.append(e)
            finals += e["type"] == "transcript.final"
        time.sleep(0.2)
        ws.send_text('{"type": "ping"}')
    cards = [e for e in events if e["type"] == "card.created" and e["kind"] == "standup"]
    assert len(cards) == 1, [e["type"] for e in events]
    # It came right after "Over to Sai." (the third line), not on Priya's turn.
    turn = next(
        e for e in events if e["type"] == "transcript.final" and e["text"] == "Thanks. Over to Sai."
    )
    assert cards[0]["seq"] > turn["seq"]
    assert "OPS-142" in cards[0]["text"]
    assert cards[0]["sources"] == [{"type": "standup", "id": today().isoformat()}]


def test_no_script_card_without_standup_prep_or_outside_standups(env) -> None:
    _, _, client, h = env
    for mtype in ("standup", "review"):
        if mtype == "review":
            client.post("/standup", json={"notes": NOTES}, headers=h)
        m = client.post("/meetings", json={"type": mtype, "title": "x"}, headers=h).json()
        with client.websocket_connect(
            f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}"
        ) as ws:
            ws.receive_json()
            for _ in range(len(STANDUP_LINES) * 50 + 5):
                ws.send_bytes(b"\x01" + b"\x00" * 640)
            events = [ws.receive_json() for _ in range(len(STANDUP_LINES) * 2)]
        assert not [e for e in events if e["type"] == "card.created" and e["kind"] == "standup"]


def test_brief_shows_open_items_and_the_last_meeting_of_the_series(env) -> None:
    s, store, client, h = env
    prev = Meeting(
        new_id(),
        "u1",
        "standup",
        "Payments standup 11/2",
        "cloud",
        "private",
        started_at=time.time() - 86400,
    )
    other = Meeting(
        new_id(), "u1", "review", "Retry review", "cloud", "private", started_at=time.time() - 3600
    )

    async def seed() -> None:
        for m in (prev, other):
            await store.create(m)
        await store.add_segment(
            Segment(
                prev.id,
                "seg_0",
                "system",
                "spk_0",
                "I'm blocked on VPN access for staging.",
                0,
                3000,
                "x",
            )
        )
        await store.add_action_item(
            prev, ActionItemRecord(new_id(), prev.id, "Rotate the staging certs", "Sai")
        )
        await store.add_action_item(
            other, ActionItemRecord(new_id(), other.id, "Add retry metrics", "Alex")
        )
        await store.replace_summary_items(
            prev,
            [],
            [DecisionRecord(new_id(), prev.id, "Freeze deploys until Thursday", source="summary")],
        )

    client.portal.call(seed)
    client.post(f"/meetings/{prev.id}/end", headers=h)
    for _ in range(300):
        if client.get(f"/meetings/{prev.id}/summary", headers=h).json()["status"] == "ready":
            break
        time.sleep(0.01)
    b = client.get(
        "/brief",
        params={"title": "Payments standup 11/3", "type": "standup", "agenda": "1. Deploy plan"},
        headers=h,
    ).json()
    assert b["last_meeting"]["id"] == prev.id
    assert "I'm blocked on VPN access for staging." in b["last_blockers"]
    assert {i["text"] for i in b["open_action_items"]} >= {
        "Rotate the staging certs",
        "Add retry metrics",
    }
    assert b["agenda"] == "1. Deploy plan"
    # For a created meeting, the brief excludes the meeting itself and uses its agenda.
    m = client.post(
        "/meetings",
        json={"type": "standup", "title": "Payments standup", "agenda": "Deploy plan"},
        headers=h,
    ).json()
    b2 = client.get("/brief", params={"meeting_id": m["meeting_id"]}, headers=h).json()
    assert b2["last_meeting"]["id"] == prev.id and b2["agenda"] == "Deploy plan"
    # Another series has no previous meeting.
    assert (
        client.get("/brief", params={"title": "Board sync", "type": "client"}, headers=h).json()[
            "last_meeting"
        ]
        is None
    )
    assert (
        client.get(
            "/brief",
            params={"meeting_id": m["meeting_id"]},
            headers={"Authorization": f"Bearer {issue_token('u2')}"},
        ).status_code
        == 404
    )


async def test_postgres_standups(pg_dsn: str) -> None:
    uid = str(uuid.UUID(int=41))
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        c.execute("insert into auth.users (id) values (%s)", (uid,))
        c.execute("insert into public.users (id) values (%s)", (uid,))
    store = PostgresStore(pg_dsn)
    st = PostgresStandups(store)
    d = date(2026, 11, 2)
    a = await st.upsert(StandupEntry(uid, None, d - timedelta(days=1), "y", ["a"], [], [], "s1"))
    b = await st.upsert(StandupEntry(uid, None, d, "t", ["b"], ["c"], [], "s2"))
    b2 = await st.upsert(StandupEntry(uid, None, d, "t2", ["b"], ["c"], ["d"], "s3"))
    assert b2.id == b.id
    assert (await st.get(uid, None, d)).script == "s3"
    assert (await st.previous(uid, None, d)).id == a.id
    # open action items and series lookups
    m = Meeting(
        new_id(), uid, "standup", "Daily 1", "cloud", "private", started_at=time.time() - 10
    )
    await store.create(m)
    await store.add_action_item(m, ActionItemRecord(new_id(), m.id, "do it"))
    [(item, mm)] = await store.open_action_items(uid)
    assert item.text == "do it" and mm.id == m.id
    assert (
        await store.previous_in_series(uid, "standup", series_key("Daily 2"), time.time(), None)
    ).id == m.id
    await store.close()
