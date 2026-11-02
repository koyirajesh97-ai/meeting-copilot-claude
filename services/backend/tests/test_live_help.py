"""Role profile, question detection and answer cards."""

from __future__ import annotations

import json
import time
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import issue_token
from app.live.help import looks_like_question, mentions
from app.live.store import CardRecord, PostgresCards
from app.main import app
from app.meetings.pg import PostgresStore
from app.meetings.store import Meeting, new_id
from app.metrics import metrics
from app.profiles.store import PRESETS, PostgresProfiles, RoleProfile
from app.router import InMemoryQuotaStore, ProviderError
from app.router.client import FakeClient
from app.router.fake_responses import fake_responder
from app.services import build_services, set_services

from .conftest import load_eval

live_eval = load_eval("live")


@pytest.mark.parametrize(
    ("text", "q"),
    [
        ("Sai, when is the deploy?", True),
        ("Can you check the certs", True),
        ("what about the rollback", True),
        ("The deploy is Thursday.", False),
        ("Great, thanks everyone.", False),
    ],
)
def test_question_rules(text: str, q: bool) -> None:
    assert looks_like_question(text) is q


def test_mentions_match_whole_names_only() -> None:
    assert mentions("SK, where is it?", ["SK"])
    assert not mentions("ask the team", ["SK"])
    assert mentions("is the payments cluster up?", ["payments cluster"])


def test_profile_names_include_first_name() -> None:
    assert RoleProfile(name="Sai Krishna", aliases=["SK"]).names() == ["Sai Krishna", "Sai", "SK"]


def test_eval_three_cited_cards_none_for_someone_else_and_fast() -> None:
    metrics.reset()
    report = live_eval.run(live_eval.make_services())
    assert report["passed"] == report["total"], report["rows"]
    assert report["saved_cards"] == 4  # 3 answers + 1 "no grounded answer"
    assert report["latency_ms"]["median"] <= 2500
    assert metrics.snapshot()["card.total_ms"]["count"] == 4


def test_a_rate_limited_groq_still_produces_cards() -> None:
    client = FakeClient(
        responder=fake_responder,
        script={"groq/openai/gpt-oss-20b": [ProviderError("rate limited", status=429)]},
    )
    report = live_eval.run(live_eval.make_services(client=client))
    assert report["passed"] == report["total"], report["rows"]
    cards = [r for r in report["rows"] if r["expect"] == "card"]
    assert {r["provider"] for r in cards} == {"groq/openai/gpt-oss-120b"}
    sw = report["switches"]
    assert sw and sw[0]["task"] == "card" and sw[0]["from"] == "groq/openai/gpt-oss-20b"


def test_detection_falls_back_to_rules_when_detect_is_down() -> None:
    err = ProviderError("down", status=503)
    client = FakeClient(
        responder=fake_responder,
        script={"groq/llama-3.1-8b-instant": [err], "groq/openai/gpt-oss-20b": [err]},
    )
    # gpt-oss-20b also serves cards; let cards fall back to 120b.
    report = live_eval.run(live_eval.make_services(client=client))
    got = {r["text"]: r["got"] for r in report["rows"]}
    assert got["Sai, when is the payments cluster deploy?"] == "card"
    assert got["Priya, can you share the test report today?"] == "not_me"


@pytest.fixture
def env():
    s = build_services(client=FakeClient(responder=fake_responder), store=InMemoryQuotaStore())
    set_services(s)
    with TestClient(app) as client:
        yield s, client
    set_services(None)


def test_profile_api_presets_and_round_trip(env) -> None:
    _, client = env
    h = {"Authorization": f"Bearer {issue_token('u1')}"}
    presets = client.get("/profiles/presets", headers=h).json()
    assert set(presets) == set(PRESETS) and presets["devops_sre"]["title"] == "DevOps/SRE"
    assert client.get("/me/profile", headers=h).json()["name"] == ""
    body = PRESETS["devops_sre"].model_dump() | {
        "name": "Sai",
        "aliases": [" SK ", ""],
        "systems_owned": ["ArgoCD", " "],
    }
    saved = client.put("/me/profile", json=body, headers=h).json()
    assert saved["aliases"] == ["SK"] and saved["systems_owned"] == ["ArgoCD"]
    assert client.get("/me/profile", headers=h).json() == saved
    assert (
        client.get("/me/profile", headers={"Authorization": f"Bearer {issue_token('u2')}"}).json()[
            "name"
        ]
        == ""
    )


def test_card_feedback_is_saved_and_checked(env) -> None:
    s, client = env
    h = {"Authorization": f"Bearer {issue_token('u1')}"}
    m = client.post("/meetings", json={"title": "x"}, headers=h).json()
    card_id = str(uuid.uuid4())
    client.portal.call(
        s.cards.add, CardRecord(card_id, m["meeting_id"], "answer", "- hi", [], 0.8, "fake")
    )
    with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
        ws.receive_json()
        ws.send_text(
            json.dumps(
                {"type": "control", "action": "card_feedback", "card_id": card_id, "useful": True}
            )
        )
        ws.send_text(
            json.dumps(
                {"type": "control", "action": "card_feedback", "card_id": "nope", "useful": False}
            )
        )
        assert ws.receive_json()["code"] == "unknown_card"
        ws.send_text(json.dumps({"type": "control", "action": "card_feedback"}))
        assert ws.receive_json()["code"] == "bad_message"
    time.sleep(0.05)
    cards = client.get(f"/meetings/{m['meeting_id']}/cards", headers=h).json()
    assert [(c["id"], c["used"]) for c in cards] == [(card_id, True)]
    assert (
        client.get(
            f"/meetings/{m['meeting_id']}/cards",
            headers={"Authorization": f"Bearer {issue_token('u2')}"},
        ).status_code
        == 404
    )


async def test_postgres_profiles_and_cards(pg_dsn: str) -> None:
    uid = str(uuid.UUID(int=31))
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        c.execute("insert into auth.users (id) values (%s)", (uid,))
        c.execute("insert into public.users (id) values (%s)", (uid,))
    store = PostgresStore(pg_dsn)
    profiles = PostgresProfiles(store)
    assert await profiles.get(uid) is None
    p = RoleProfile(
        name="Sai", aliases=["SK"], title="SRE", systems_owned=["ArgoCD"], current_tickets=["OPS-1"]
    )
    await profiles.put(uid, p)
    await profiles.put(uid, p.model_copy(update={"title": "DevOps/SRE"}))
    got = await profiles.get(uid)
    assert (
        got is not None
        and got.title == "DevOps/SRE"
        and got.name == "Sai"
        and got.aliases == ["SK"]
    )
    with psycopg.connect(pg_dsn) as c:
        assert c.execute(
            "select count(*) from role_profiles where user_id = %s", (uid,)
        ).fetchone() == (1,)

    m = Meeting(new_id(), uid, "review", "t", "cloud", "private")
    await store.create(m)
    cards = PostgresCards(store)
    cid = str(uuid.uuid4())
    await cards.add(
        CardRecord(
            cid, m.id, "answer", "- a", [{"type": "meeting", "id": "x"}], 0.7, "fake", "seg_1"
        )
    )
    assert await cards.feedback(m.id, cid, False)
    assert not await cards.feedback(m.id, "not-a-uuid", True)
    [row] = await cards.for_meeting(m.id)
    assert (row.used, row.sources, row.trigger_segment_id) == (
        False,
        [{"type": "meeting", "id": "x"}],
        "seg_1",
    )
    await store.close()
