"""Integrations (Prompt 16): calendars, Jira, and posting summaries to Slack or Teams."""

from __future__ import annotations

import json
import time
import uuid
from urllib.parse import parse_qs, urlparse

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import issue_token
from app.integrations.base import FakePoster, IntegrationError, guess_type
from app.integrations.calendars import GoogleCalendar, MicrosoftCalendar
from app.integrations.jira import JiraCloud
from app.integrations.service import IntegrationService, real_factory
from app.integrations.store import InMemoryIntegrations, Integration, PostgresIntegrations
from app.integrations.webhooks import WebhookPoster, check_webhook, payload
from app.main import app
from app.meetings.pg import PostgresStore
from app.meetings.store import InMemoryMeetingStore, Meeting, Segment, new_id
from app.router import InMemoryQuotaStore, load_config
from app.services import build_services, set_services

SLACK = "https://hooks.slack.com/services/T000/B000/XXXX"
TEAMS = "https://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x"


def h(user: str = "u1") -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(user)}"}


@pytest.fixture
def env():
    store = InMemoryMeetingStore()
    s = build_services(config=load_config(), store=InMemoryQuotaStore(), meetings=store)
    set_services(s)
    with TestClient(app) as client:
        yield s, store, client
    set_services(None)


@pytest.mark.parametrize(
    ("title", "attendees", "kind"),
    [
        ("Payments daily standup", 8, "standup"),
        ("SEV2 checkout outage war room", 12, "incident"),
        ("Sprint 42 retro", 7, "review"),
        ("Q3 roadmap planning", 5, "planning"),
        ("Sai / Priya 1:1", 2, "one_on_one"),
        ("Coffee", 2, "one_on_one"),
        ("Acme client check-in", 4, "client"),
        ("Lunch & learn: Kubernetes", 30, "research"),
        ("Misc", 5, "custom"),
    ],
)
def test_meeting_type_is_guessed_from_the_event(title: str, attendees: int, kind: str) -> None:
    assert guess_type(title, attendees) == kind


# ---------- adapters, against mocked HTTP ----------


def _token_handler(req: httpx.Request, seen: list) -> httpx.Response:
    form = parse_qs(req.content.decode())
    seen.append(form)
    if form["grant_type"] == ["refresh_token"] and form["refresh_token"] == ["revoked"]:
        return httpx.Response(400, json={"error": "invalid_grant"})
    return httpx.Response(
        200, json={"access_token": "at-new", "expires_in": 3600, "refresh_token": "rt-rotated"}
    )


async def test_google_calendar_refreshes_and_skips_all_day_and_cancelled(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "sec")
    seen: list = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "oauth2.googleapis.com":
            return _token_handler(req, seen)
        assert req.headers["Authorization"] == "Bearer at-new"
        assert req.url.params["singleEvents"] == "true"
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": "e1",
                        "summary": "Daily standup",
                        "start": {"dateTime": "2026-11-03T15:00:00Z"},
                        "end": {"dateTime": "2026-11-03T15:15:00Z"},
                        "attendees": [{}, {}, {}],
                        "hangoutLink": "https://meet.google.com/x",
                    },
                    {
                        "id": "e2",
                        "summary": "Holiday",
                        "start": {"date": "2026-11-04"},
                        "end": {"date": "2026-11-05"},
                    },
                    {
                        "id": "e3",
                        "summary": "Cancelled",
                        "status": "cancelled",
                        "start": {"dateTime": "2026-11-03T16:00:00-05:00"},
                        "end": {"dateTime": "2026-11-03T17:00:00-05:00"},
                    },
                ]
            },
        )

    cal = GoogleCalendar(httpx.MockTransport(handler))
    [e] = await cal.upcoming({"refresh_token": "rt"}, 0, 2e9)
    assert (e.id, e.title, e.attendees, e.join_url) == (
        "google:e1",
        "Daily standup",
        3,
        "https://meet.google.com/x",
    )
    assert e.end - e.start == 900
    assert cal.updated_creds["access_token"] == "at-new" and seen[0]["client_id"] == ["cid"]
    with pytest.raises(IntegrationError) as err:
        await cal.upcoming({"refresh_token": "revoked"}, 0, 2e9)
    assert err.value.reconnect


async def test_microsoft_calendar_parses_graph_times_and_keeps_rotated_tokens(monkeypatch) -> None:
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "cid")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "sec")

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "login.microsoftonline.com":
            return _token_handler(req, [])
        assert 'outlook.timezone="UTC"' in req.headers["Prefer"]
        return httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": "m1",
                        "subject": "SEV1 war room",
                        "start": {"dateTime": "2026-11-03T15:00:00.0000000"},
                        "end": {"dateTime": "2026-11-03T16:00:00.0000000"},
                        "attendees": [{}] * 9,
                        "bodyPreview": "bridge",
                        "onlineMeeting": {"joinUrl": "https://teams.microsoft.com/l/x"},
                    },
                    {
                        "id": "m2",
                        "subject": "OOO",
                        "isAllDay": True,
                        "start": {"dateTime": "2026-11-04T00:00:00.0000000"},
                        "end": {"dateTime": "2026-11-05T00:00:00.0000000"},
                    },
                ]
            },
        )

    cal = MicrosoftCalendar(httpx.MockTransport(handler))
    [e] = await cal.upcoming({"refresh_token": "rt"}, 0, 2e9)
    assert e.start == 1793718000.0 and e.end - e.start == 3600 and e.description == "bridge"
    assert guess_type(e.title, e.attendees) == "incident"
    assert cal.updated_creds["refresh_token"] == "rt-rotated"


async def test_jira_asks_for_my_tickets_updated_since() -> None:
    sent: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        sent.append(req)
        return httpx.Response(
            200,
            json={
                "issues": [
                    {
                        "key": "OPS-142",
                        "fields": {
                            "summary": "Renew cert",
                            "status": {"name": "Done"},
                            "updated": "2026-11-03T09:12:00.000+0000",
                        },
                    },
                ]
            },
        )

    j = JiraCloud(httpx.MockTransport(handler))
    creds = {"site": "https://team.atlassian.net/", "email": "sai@example.com", "api_token": "tok"}
    [t] = await j.updated_since(creds, 1793664000)  # 2026-11-03 00:00 UTC
    assert (t.key, t.status, t.url) == (
        "OPS-142",
        "Done",
        "https://team.atlassian.net/browse/OPS-142",
    )
    body = json.loads(sent[0].content)
    assert (
        body["jql"]
        == 'assignee = currentUser() AND updated >= "2026-11-03 00:00" ORDER BY updated DESC'
    )
    assert str(sent[0].url) == "https://team.atlassian.net/rest/api/3/search/jql"
    assert sent[0].headers["Authorization"].startswith("Basic ")
    bad = JiraCloud(httpx.MockTransport(lambda r: httpx.Response(401)))
    with pytest.raises(IntegrationError) as err:
        await bad.updated_since(creds, 0)
    assert err.value.reconnect
    with pytest.raises(IntegrationError, match="https"):
        await j.updated_since({**creds, "site": "http://team.atlassian.net"}, 0)


async def test_webhooks_only_go_to_slack_or_teams() -> None:
    assert check_webhook("slack", SLACK) == SLACK
    assert check_webhook("teams", TEAMS) == TEAMS
    assert check_webhook("teams", "https://contoso.webhook.office.com/webhookb2/x")
    for kind, url in [
        ("slack", "http://hooks.slack.com/x"),
        ("slack", "https://hooks.slack.com.evil.io/x"),
        ("teams", "https://evil.com/logic.azure.com"),
        ("teams", "https://notlogic.azure.com/x"),
        ("slack", TEAMS),
    ]:
        with pytest.raises(IntegrationError):
            check_webhook(kind, url)  # type: ignore[arg-type]
    assert payload("slack", "hi") == {"text": "hi", "mrkdwn": True}
    assert payload("teams", "hi")["attachments"][0]["content"]["body"][0]["text"] == "hi"
    got: list[dict] = []
    poster = WebhookPoster(
        "slack",
        httpx.MockTransport(lambda r: (got.append(json.loads(r.content)), httpx.Response(200))[1]),
    )
    await poster.post({"webhook_url": SLACK}, "Summary")
    assert got == [{"text": "Summary", "mrkdwn": True}]


# ---------- the API (Fake adapters) ----------


def test_settings_list_save_and_never_return_secrets(env) -> None:
    _, _, client = env
    kinds = [i["kind"] for i in client.get("/integrations", headers=h()).json()]
    assert kinds == ["google", "microsoft", "jira", "slack", "teams"]
    r = client.put(
        "/integrations/slack", json={"webhook_url": "https://example.com/hook"}, headers=h()
    )
    assert r.status_code == 400 and "Slack webhook" in r.json()["detail"]
    assert (
        client.put(
            "/integrations/jira", json={"site": "https://team.atlassian.net"}, headers=h()
        ).status_code
        == 400
    )
    ok = client.put(
        "/integrations/jira",
        json={
            "site": "https://team.atlassian.net",
            "email": "sai@example.com",
            "api_token": "secret-token",
        },
        headers=h(),
    )
    assert ok.status_code == 200 and ok.json()["connected"]
    client.put("/integrations/slack", json={"webhook_url": SLACK}, headers=h())
    listed = client.get("/integrations", headers=h()).text
    assert "secret-token" not in listed and "hooks.slack.com" not in listed
    # Turning it off keeps the token; turning it back on needs no re-entry.
    assert (
        client.put("/integrations/jira", json={"enabled": False}, headers=h()).json()["enabled"]
        is False
    )
    assert (
        client.put("/integrations/jira", json={"enabled": True}, headers=h()).json()["enabled"]
        is True
    )
    assert client.delete("/integrations/jira", headers=h()).status_code == 204
    assert not {i["kind"]: i for i in client.get("/integrations", headers=h()).json()}["jira"][
        "connected"
    ]
    assert client.put("/integrations/github", json={}, headers=h()).status_code == 404


def test_upcoming_meetings_and_starting_one_from_the_calendar(env) -> None:
    _, store, client = env
    assert client.get("/calendar/upcoming", headers=h()).json() == []  # nothing connected
    client.put("/integrations/google", json={"enabled": True}, headers=h())
    events = client.get("/calendar/upcoming", headers=h()).json()
    standup = events[0]
    assert standup["title"] == "Payments daily standup" and standup["guessed_type"] == "standup"
    assert 0 < standup["start"] - time.time() <= 90 and standup["meeting_id"] is None
    m = client.post("/meetings", json={"calendar_event_id": standup["id"]}, headers=h()).json()
    created = client.portal.call(store.get, m["meeting_id"])
    assert (created.title, created.type, created.calendar_event_id) == (
        "Payments daily standup",
        "standup",
        standup["id"],
    )
    assert created.agenda.startswith("1. Deploy plan")
    assert client.get("/calendar/upcoming", headers=h()).json()[0]["meeting_id"] == m["meeting_id"]
    # Your choices win over the guess.
    m2 = client.post(
        "/meetings",
        json={"calendar_event_id": events[1]["id"], "type": "planning", "title": "Mine"},
        headers=h(),
    ).json()
    assert client.portal.call(store.get, m2["meeting_id"]).type == "planning"
    assert (
        client.post("/meetings", json={"calendar_event_id": "google:nope"}, headers=h()).status_code
        == 404
    )
    assert client.get("/calendar/upcoming", headers=h("u2")).json() == []  # per user


def test_jira_tickets_feed_standup_prep(env) -> None:
    _, _, client = env
    client.put(
        "/integrations/jira",
        json={"site": "https://team.atlassian.net", "email": "s@example.com", "api_token": "t"},
        headers=h(),
    )
    tickets = client.get("/standup/tickets", headers=h()).json()
    assert [t["key"] for t in tickets] == ["OPS-142", "OPS-150"]
    out = client.post("/standup", json={"notes": "fixed the login tests"}, headers=h()).json()
    assert any("OPS-142" in x for x in out["done"]) and any("OPS-150" in x for x in out["doing"])
    assert client.get("/standup/tickets", headers=h("u2")).json() == []


def _meeting_with_summary(client, store) -> str:
    m = Meeting(new_id(), "u1", "review", "Retry review", "cloud", "private")
    client.portal.call(store.create, m)
    client.portal.call(
        store.add_segment,
        Segment(
            m.id, "seg_0", "system", "spk_0", "Alex will add retry metrics by Friday.", 0, 3000, "x"
        ),
    )
    client.post(f"/meetings/{m.id}/end", headers=h())
    for _ in range(300):
        if client.get(f"/meetings/{m.id}/summary", headers=h()).json()["status"] == "ready":
            break
        time.sleep(0.01)
    return m.id


def test_post_summary_only_after_preview_and_confirm(env) -> None:
    s, store, client = env
    mid = _meeting_with_summary(client, store)
    poster: FakePoster = s.integrations.factory("slack")
    pv = client.post(f"/meetings/{mid}/share/preview", json={"target": "slack"}, headers=h()).json()
    assert pv["text"].startswith("# Retry review") and "Transcript" not in pv["text"]
    # Not configured yet.
    r = client.post(
        f"/meetings/{mid}/share",
        json={"target": "slack", "text": pv["text"], "preview_token": pv["preview_token"]},
        headers=h(),
    )
    assert r.status_code == 400 and "webhook" in r.json()["detail"]
    client.put("/integrations/slack", json={"webhook_url": SLACK}, headers=h())
    # No preview, a forged token, or a token for another target: refused, nothing posted.
    for token, target in [
        ("x", "slack"),
        (issue_token("u1"), "slack"),
        (pv["preview_token"], "teams"),
    ]:
        r = client.post(
            f"/meetings/{mid}/share",
            json={"target": target, "text": "hi", "preview_token": token},
            headers=h(),
        )
        assert r.status_code in (400, 403)
    assert poster.posts == []
    edited = pv["text"] + "\nPosted by Sai."
    r = client.post(
        f"/meetings/{mid}/share",
        json={"target": "slack", "text": edited, "preview_token": pv["preview_token"]},
        headers=h(),
    )
    assert r.status_code == 204
    assert poster.posts == [(SLACK, edited)]
    assert (
        client.post(
            f"/meetings/{mid}/share/preview", json={"target": "slack"}, headers=h("u2")
        ).status_code
        == 404
    )


# ---------- calendar OAuth ----------


def test_calendar_oauth_connect_and_callback(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "sec")
    transport = httpx.MockTransport(
        lambda r: httpx.Response(
            200, json={"access_token": "at", "refresh_token": "rt", "expires_in": 3600}
        )
    )
    s = build_services(
        config=load_config(), store=InMemoryQuotaStore(), meetings=InMemoryMeetingStore()
    )
    s.integrations = IntegrationService(InMemoryIntegrations(), real_factory(transport))
    s.integrations.transport = transport
    set_services(s)
    try:
        with TestClient(app) as client:
            assert {i["kind"]: i for i in client.get("/integrations", headers=h()).json()}[
                "microsoft"
            ]["available"] is False
            assert client.post("/integrations/microsoft/connect", headers=h()).status_code == 409
            url = client.post("/integrations/google/connect", headers=h()).json()["authorize_url"]
            q = parse_qs(urlparse(url).query)
            assert (
                q["client_id"] == ["cid"]
                and q["access_type"] == ["offline"]
                and "calendar.readonly" in q["scope"][0]
            )
            assert (
                client.get(
                    "/integrations/oauth/callback", params={"state": "forged", "code": "c"}
                ).status_code
                == 400
            )
            r = client.get(
                "/integrations/oauth/callback", params={"state": q["state"][0], "code": "c"}
            )
            assert r.status_code == 200 and "connected" in r.text
            i = client.portal.call(s.integrations.store.get, "u1", "google")
            assert i.secret["refresh_token"] == "rt"
            assert {x["kind"]: x for x in client.get("/integrations", headers=h()).json()}[
                "google"
            ]["connected"]
    finally:
        set_services(None)


async def test_a_revoked_calendar_is_marked_for_reconnect() -> None:
    class Broken:
        updated_creds = None

        async def upcoming(self, creds, start, end):
            raise IntegrationError("revoked", reconnect=True)

    store = InMemoryIntegrations()
    await store.put(Integration("u1", "google", True, {}, {"refresh_token": "rt"}))
    svc = IntegrationService(store, lambda kind: Broken())
    assert await svc.upcoming("u1") == []
    i = await store.get("u1", "google")
    assert i.secret == {} and i.last_error == "revoked"


# ---------- Postgres ----------


async def test_postgres_integrations_store_secrets_encrypted(pg_dsn: str) -> None:
    uid = str(uuid.UUID(int=61))
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        c.execute("insert into auth.users (id) values (%s)", (uid,))
        c.execute("insert into public.users (id) values (%s)", (uid,))
    store = PostgresStore(pg_dsn)
    ints = PostgresIntegrations(store)
    await ints.put(
        Integration(
            uid, "jira", True, {"site": "https://t.atlassian.net"}, {"api_token": "very-secret"}
        )
    )
    got = await ints.get(uid, "jira")
    assert (
        got.secret == {"api_token": "very-secret"}
        and got.config["site"] == "https://t.atlassian.net"
    )
    with psycopg.connect(pg_dsn) as c:
        raw = c.execute(
            "select secret from public.user_integrations where user_id = %s", (uid,)
        ).fetchone()[0]
    assert b"very-secret" not in bytes(raw)
    assert [i.kind for i in await ints.for_user(uid)] == ["jira"]
    m = Meeting(
        new_id(), uid, "standup", "Daily", "cloud", "private", calendar_event_id="google:e1"
    )
    await store.create(m)
    assert (await store.get(m.id)).calendar_event_id == "google:e1"
    await ints.delete(uid, "jira")
    assert await ints.get(uid, "jira") is None
    await store.close()
