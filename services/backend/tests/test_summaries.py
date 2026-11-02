"""Summaries: chunking, templates, grounding, the job, routes, export, and the eval."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.auth import issue_token
from app.main import app
from app.meetings.pg import PostgresStore
from app.meetings.store import ActionItemRecord, InMemoryMeetingStore, Meeting, Segment, new_id
from app.router import InMemoryQuotaStore, ProviderError
from app.router.client import FakeClient
from app.router.fake_responses import fake_responder
from app.services import build_services, set_services
from app.summaries.pipeline import chunk_lines, ground, summarize, transcript_lines
from app.summaries.schema import ActionItem, Summary
from app.summaries.templates import TEMPLATES, template_for

from .conftest import load_eval

summary_eval = load_eval("summaries")

LINES = [
    ("spk_0", "We decided to keep the retry limit at three."),
    ("spk_1", "Alex will add metrics for the retry path by Friday."),
    ("me", "I'll update the runbook with the rollback steps."),
    ("spk_0", "Should we also cover the timeout case?"),
    ("spk_1", "I'm blocked on access to the staging dashboards."),
]


def segs(mid: str = "m1", lines=LINES) -> list[Segment]:
    return [
        Segment(
            mid,
            f"seg_{i}",
            "mic" if who == "me" else "system",
            who,
            text,
            i * 5000,
            i * 5000 + 4000,
            "fake",
        )
        for i, (who, text) in enumerate(lines)
    ]


def fake_services(**kw):
    return build_services(
        client=FakeClient(responder=fake_responder, **kw.pop("client_kw", {})),
        store=InMemoryQuotaStore(),
        **kw,
    )


def test_transcript_lines_use_names_and_clock() -> None:
    lines = transcript_lines(segs()[:3], {"spk_1": "Alex"})
    assert lines == [
        "[00:00] Speaker 1: We decided to keep the retry limit at three.",
        "[00:05] Alex: Alex will add metrics for the retry path by Friday.",
        "[00:10] Me: I'll update the runbook with the rollback steps.",
    ]


def test_chunks_stay_under_the_token_budget() -> None:
    lines = [f"[00:{i % 60:02d}] Speaker 1: " + "word " * 40 for i in range(2000)]
    chunks = chunk_lines(lines)
    assert len(chunks) > 1
    assert all(len(c) / 4 <= 5000 for c in chunks)
    assert sum(c.count("\n") + 1 for c in chunks) == 2000


def test_owners_and_dates_stay_null_unless_said() -> None:
    s = Summary(
        action_items=[
            ActionItem(owner="Bob", text="x", due_date="Monday"),
            ActionItem(owner="Alex", text="y", due_date="Friday"),
        ]
    )
    ground(s, "Alex will do it by Friday")
    assert [(a.owner, a.due_date) for a in s.action_items] == [(None, None), ("Alex", "Friday")]


@pytest.mark.parametrize("meeting_type", list(TEMPLATES))
async def test_every_template_yields_its_sections_in_order(meeting_type: str) -> None:
    s = fake_services()
    t = template_for(meeting_type)
    r = await summarize(s.router, meeting_type, segs(), t, data_class="test")
    assert [x.key for x in r.summary.sections] == [x.key for x in t.sections]
    assert bool(r.summary.per_person) == (meeting_type == "standup")
    assert any("runbook" in a.text for a in r.summary.action_items)


async def test_invalid_json_from_the_first_provider_falls_back() -> None:
    s = fake_services(client_kw={"script": {"mistral/mistral-small-latest": ["not json"]}})
    r = await summarize(s.router, "review", segs(), template_for("review"))
    assert r.provider == "groq/openai/gpt-oss-120b"


async def test_empty_meeting_gets_a_short_summary_without_ai_calls() -> None:
    s = fake_services()
    r = await summarize(s.router, "custom", [], template_for("custom"))
    assert r.summary.overview.startswith("Nothing was transcribed")


@pytest.fixture
def env():
    store = InMemoryMeetingStore()
    s = fake_services(meetings=store)
    set_services(s)
    with TestClient(app) as client:
        yield s, store, client, {"Authorization": f"Bearer {issue_token('u1')}"}
    set_services(None)


async def _seed(store, mode="cloud", mid=None) -> Meeting:
    m = Meeting(
        id=mid or new_id(),
        owner_id="u1",
        type="review",
        title="Retry review",
        mode=mode,
        visibility="private",
    )
    await store.create(m)
    for sg in segs(m.id):
        await store.add_segment(sg)
    return m


def test_ending_a_meeting_summarizes_it(env) -> None:
    s, store, client, h = env
    m = asyncio.run(_seed(store))
    assert client.post(f"/meetings/{m.id}/end", headers=h).status_code == 204
    asyncio.run(s.summaries.wait(m.id))  # TestClient's loop ran the job; make sure it's done
    detail = client.get(f"/meetings/{m.id}", headers=h).json()
    summary = detail["summary"]
    assert summary["status"] == "ready" and summary["template"] == "review"
    assert [x["key"] for x in summary["data"]["sections"]] == ["decisions", "feedback", "rework"]
    items = {a["text"]: a for a in detail["action_items"]}
    alex = items["Alex will add metrics for the retry path by Friday."]
    assert (alex["owner"], alex["due"], alex["source"]) == ("Alex", "Friday", "summary")
    assert [d["text"] for d in detail["decisions"]] == [
        "We decided to keep the retry limit at three."
    ]


def _wait_ready(client, h, mid) -> dict:
    for _ in range(100):
        r = client.get(f"/meetings/{mid}/summary", headers=h).json()
        if r["status"] in ("ready", "failed"):
            return r
        asyncio.run(asyncio.sleep(0.01))
    raise AssertionError("summary never finished")


def test_regenerate_edit_rename_and_export(env) -> None:
    s, store, client, h = env
    m = asyncio.run(_seed(store))
    asyncio.run(store.add_action_item(m, ActionItemRecord(new_id(), m.id, "Manual item I added")))
    client.post(f"/meetings/{m.id}/end", headers=h)
    first = _wait_ready(client, h, m.id)

    r = client.post(
        f"/meetings/{m.id}/summary/regenerate", json={"template": "incident"}, headers=h
    )
    assert r.status_code == 202
    again = _wait_ready(client, h, m.id)
    assert again["template"] == "incident" and again["id"] != first["id"]
    assert [x["key"] for x in again["data"]["sections"]] == ["timeline", "root_cause", "next_steps"]
    texts = [a["text"] for a in client.get(f"/meetings/{m.id}", headers=h).json()["action_items"]]
    assert texts.count("Manual item I added") == 1  # kept; summary items replaced, not duplicated
    assert texts.count("I'll update the runbook with the rollback steps.") == 1

    edited = again["data"] | {
        "overview": "Edited by hand.",
        "action_items": [{"text": "Only this item now", "owner": "Priya", "due_date": None}],
    }
    assert (
        client.put(f"/meetings/{m.id}/summary", json={"data": edited}, headers=h).json()["data"][
            "overview"
        ]
        == "Edited by hand."
    )
    after_edit = [
        a["text"] for a in client.get(f"/meetings/{m.id}", headers=h).json()["action_items"]
    ]
    assert sorted(after_edit) == ["Manual item I added", "Only this item now"]
    assert (
        client.post(
            f"/meetings/{m.id}/summary/regenerate", json={"template": "nope"}, headers=h
        ).status_code
        == 422
    )

    assert (
        client.post(
            f"/meetings/{m.id}/speakers/spk_1/rename", json={"display_name": "Alex"}, headers=h
        ).status_code
        == 204
    )
    assert (
        client.post(
            f"/meetings/{m.id}/speakers/me/rename", json={"display_name": "X"}, headers=h
        ).status_code
        == 422
    )
    md = client.get(f"/meetings/{m.id}/export?format=md", headers=h)
    assert md.headers["content-type"].startswith("text/markdown")
    body = md.text
    assert body.startswith("# Retry review")
    assert "Edited by hand." in body and "## Root cause so far" in body
    assert "- [ ] Manual item I added" in body
    assert "[00:05] Alex: Alex will add metrics" in body
    assert (
        "Transcript" not in client.get(f"/meetings/{m.id}/export?transcript=false", headers=h).text
    )


def test_live_only_meetings_are_not_summarized(env) -> None:
    s, store, client, h = env
    m = asyncio.run(_seed(store, mode="live-only"))
    assert (
        client.post(f"/meetings/{m.id}/summary/regenerate", json={}, headers=h).status_code == 409
    )
    client.post(f"/meetings/{m.id}/end", headers=h)
    # Nothing is summarized, and the meeting itself is gone once it ends.
    assert client.get(f"/meetings/{m.id}/summary", headers=h).status_code == 404
    assert asyncio.run(store.get(m.id)) is None


def test_failed_summary_is_reported(env) -> None:
    s, store, client, h = env
    err = ProviderError("down", status=500)
    s.router.client.script = {d.id: [err] for d in s.config.tasks["summary"]}
    m = asyncio.run(_seed(store))
    client.post(f"/meetings/{m.id}/end", headers=h)
    r = _wait_ready(client, h, m.id)
    assert r["status"] == "failed" and "NoProviderAvailable" in r["error"]


def test_templates_route(env) -> None:
    _, _, client, h = env
    ids = [t["id"] for t in client.get("/templates", headers=h).json()]
    assert ids == list(TEMPLATES)


async def test_summary_eval_meets_the_recall_target_in_fake_mode() -> None:
    report = await summary_eval.run(fake_services().router, long=True)
    assert report["recall"] >= 0.9, report
    assert report["long"]["minutes"] >= 50 and report["long"]["chunks"] >= 1


async def test_summary_storage_in_postgres(pg_dsn: str) -> None:
    import psycopg

    with psycopg.connect(pg_dsn, autocommit=True) as c:
        c.execute(
            "insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000009', 'a@b.c')"
        )
        c.execute(
            "insert into public.users (id, email) values ('00000000-0000-4000-8000-000000000009', 'a@b.c')"
        )
    store = PostgresStore(pg_dsn)
    s = fake_services(meetings=store)
    m = Meeting(
        id=new_id(),
        owner_id="00000000-0000-4000-8000-000000000009",
        type="review",
        title="PG",
        mode="cloud",
        visibility="private",
    )
    await store.create(m)
    for sg in segs(m.id):
        await store.add_segment(sg)
    await store.add_action_item(
        m, ActionItemRecord(new_id(), m.id, "manual", due_text="2026-11-06")
    )
    await s.summaries.enqueue(m.id)
    await s.summaries.wait(m.id)
    assert await store.summary_status(m.id) == ("ready", None)
    first = await store.latest_summary(m.id)
    await s.summaries.enqueue(m.id, "incident")
    await s.summaries.wait(m.id)
    latest = await store.latest_summary(m.id)
    assert latest.id != first.id and latest.template == "incident"
    items = await store.action_items(m.id)
    assert sorted(i.source for i in items).count("summary") == len(
        [i for i in items if i.source == "summary"]
    )
    assert [i.text for i in items if i.source == "manual"] == ["manual"]
    assert len([i for i in items if "runbook" in i.text]) == 1
    await store.set_speaker_name(m.id, "spk_1", "Alex")
    await store.set_speaker_name(m.id, "spk_1", "Alexandra")
    assert await store.speaker_names(m.id) == {"spk_1": "Alexandra"}
    await store.update_summary(latest.id, latest.sections | {"overview": "edited"})
    assert (await store.latest_summary(m.id)).sections["overview"] == "edited"
    assert len(await store.decisions(m.id)) == 1
    with psycopg.connect(pg_dsn) as c:
        assert c.execute(
            "select due_date::text from action_items where text = 'manual'"
        ).fetchone() == ("2026-11-06",)
    await store.close()
