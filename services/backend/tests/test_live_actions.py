"""Catch me up, Clarify, I'll follow up (with the drafted reply after the meeting) and topic cards."""

from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from app.auth import issue_token
from app.main import app
from app.meetings.store import InMemoryMeetingStore, Meeting, Segment, new_id
from app.metrics import metrics
from app.providers.stt.base import FakeSttAdapter
from app.router import InMemoryQuotaStore, load_config
from app.services import build_services, set_services

PROFILE = {
    "name": "Sai",
    "aliases": ["SK"],
    "title": "DevOps/SRE",
    "systems_owned": ["ArgoCD"],
    "current_tickets": ["OPS-142"],
    "speaking_style": "brief",
}
LIVE = [
    ("0", "Um, basically the ArgoCD sync is, like, drifting on prod again."),
    ("1", "Sai, what's the root cause of the cert alert from last night?"),
    ("0", "We moved the payments deploy to Thursday."),
    ("1", "And ArgoCD needs a look at the prod-east profile later."),
]


@pytest.fixture
def env():
    metrics.reset()
    store = InMemoryMeetingStore()
    s = build_services(
        config=load_config(),
        store=InMemoryQuotaStore(),
        meetings=store,
        stt_factory=lambda d, _c: FakeSttAdapter(
            d.id, [(t, w) for w, t in LIVE], seconds_per_line=1.0
        ),
    )
    set_services(s)
    with TestClient(app) as client:
        h = {"Authorization": f"Bearer {issue_token('u1')}"}
        client.put("/me/profile", json=PROFILE, headers=h)
        # A past meeting with something to say about ArgoCD (for the topic card).
        prior = Meeting(new_id(), "u1", "review", "Platform review", "cloud", "private")

        async def seed() -> None:
            await store.create(prior)
            await store.add_segment(
                Segment(
                    prior.id,
                    "seg_0",
                    "system",
                    "spk_0",
                    "ArgoCD sync for prod uses the prod-east profile now.",
                    0,
                    4000,
                    "x",
                )
            )

        client.portal.call(seed)
        client.post(f"/meetings/{prior.id}/end", headers=h)
        for _ in range(300):
            if client.get(f"/meetings/{prior.id}/summary", headers=h).json()["status"] == "ready":
                break
            time.sleep(0.01)
        yield s, store, client, h
    set_services(None)


def collect(ws, until, limit: int = 300) -> list[dict]:
    out = []
    for _ in range(limit):
        e = ws.receive_json()
        out.append(e)
        if until(e, out):
            return out
    raise AssertionError([e["type"] for e in out])


def test_overlay_actions_and_topic_cards(env) -> None:
    s, store, client, h = env
    m = client.post(
        "/meetings",
        json={
            "type": "incident",
            "title": "Prod sync",
            "vocabulary": ["ArgoCD = GitOps deploy tool"],
        },
        headers=h,
    ).json()
    with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
        ws.receive_json()
        for _ in range(len(LIVE) * 50 + 5):
            ws.send_bytes(b"\x01" + b"\x00" * 640)
        events = collect(
            ws,
            lambda e, out: (
                sum(x["type"] == "transcript.final" for x in out) == len(LIVE)
                and sum(x["type"] == "card.created" for x in out) >= 2
            ),
        )
        time.sleep(0.2)

        # Topic card: ArgoCD came up, and a past meeting has a fact about it. Only one per minute.
        topics = [e for e in events if e["type"] == "card.created" and e["kind"] == "topic"]
        assert len(topics) == 1
        assert topics[0]["text"].startswith("ArgoCD:") and "prod-east" in topics[0]["text"]
        assert topics[0]["sources"][0]["type"] == "meeting"

        # Catch me up (2 minutes): a short recap card of what was said.
        ws.send_text(json.dumps({"type": "control", "action": "catch_up", "minutes": 2}))
        got = collect(ws, lambda e, _o: e["type"] == "card.created" and e["kind"] == "catch_up")
        catch = got[-1]
        assert catch["text"].startswith("Last 2 min:")
        time.sleep(0.05)  # later bullets arrive as card.delta; the saved card has them all
        saved = {c.id: c for c in client.portal.call(s.cards.for_meeting, m["meeting_id"])}
        assert "We moved the payments deploy to Thursday." in saved[catch["card_id"]].text

        # Clarify: the last thing someone else said, in plain words, with the glossary term.
        ws.send_text(json.dumps({"type": "control", "action": "clarify"}))
        got = collect(ws, lambda e, _o: e["type"] == "card.created" and e["kind"] == "clarify")
        clar = got[-1]
        assert clar["text"].startswith("Speaker 2: And ArgoCD needs a look")
        time.sleep(0.05)

        # I'll follow up: the question to Sai becomes an action item.
        ws.send_text(json.dumps({"type": "control", "action": "follow_up"}))
        got = collect(ws, lambda e, _o: e["type"] == "card.created" and e["kind"] == "follow_up")
        assert "root cause of the cert alert" in got[-1]["text"]
        ws.send_text(json.dumps({"type": "control", "action": "follow_up"}))
        got = collect(ws, lambda e, _o: e["type"] == "card.created" and e["kind"] == "follow_up")
        assert got[-1]["text"].startswith("Already on your follow-ups")

    # Clarify used the glossary.
    clarify_card = [
        c for c in client.portal.call(s.cards.for_meeting, m["meeting_id"]) if c.kind == "clarify"
    ][0]
    assert "- ArgoCD: GitOps deploy tool" in clarify_card.text

    # After the meeting: the follow-up has a drafted reply to review.
    client.post(f"/meetings/{m['meeting_id']}/end", headers=h)
    for _ in range(300):
        items = client.get(f"/meetings/{m['meeting_id']}", headers=h).json()["action_items"]
        fu = [i for i in items if i["source"] == "follow_up"]
        if fu and fu[0]["draft"]:
            break
        time.sleep(0.01)
    assert len(fu) == 1
    assert fu[0]["question"] == "Sai, what's the root cause of the cert alert from last night?"
    assert fu[0]["asker"] == "Speaker 2" and fu[0]["owner"] == "Sai"
    assert fu[0]["draft"].startswith("Following up")

    # Each action answered well within 3 s (Fake providers).
    snap = metrics.snapshot()
    for stage in ("action.catch_up_ms", "action.clarify_ms"):
        assert snap[stage]["max"] < 3000


def test_actions_with_nothing_to_act_on(env) -> None:
    _, _, client, h = env
    m = client.post("/meetings", json={"title": "Empty"}, headers=h).json()
    with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
        ws.receive_json()
        for action, text in [
            ("catch_up", "Nothing has been said yet."),
            ("clarify", "No one else has spoken yet."),
            ("follow_up", "No recent question to follow up on."),
        ]:
            ws.send_text(json.dumps({"type": "control", "action": action}))
            e = ws.receive_json()
            assert (e["kind"], e["text"]) == (action, text)


def test_live_only_follow_ups_are_not_saved(env) -> None:
    s, store, client, h = env
    m = client.post("/meetings", json={"title": "Live only", "mode": "live-only"}, headers=h).json()
    with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
        ws.receive_json()
        for _ in range(len(LIVE) * 50 + 5):
            ws.send_bytes(b"\x01" + b"\x00" * 640)
        collect(ws, lambda e, out: sum(x["type"] == "question.detected" for x in out) >= 1)
        ws.send_text(json.dumps({"type": "control", "action": "follow_up"}))
        collect(ws, lambda e, _o: e["type"] == "card.created" and e["kind"] == "follow_up")
    assert client.portal.call(store.action_items, m["meeting_id"]) == []
