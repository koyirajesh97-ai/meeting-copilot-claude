"""Projects and team sync: roles, invites, sharing, live watching, documents, vocabulary, board."""

from __future__ import annotations

import time
import uuid

import httpx
import jwt
import psycopg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.auth import issue_token
from app.main import app
from app.meetings.pg import PostgresStore
from app.meetings.store import ActionItemRecord, InMemoryMeetingStore, Meeting, Segment, new_id
from app.projects.documents import Document, PostgresDocuments, document_chunks
from app.projects.invites import send_invite_email
from app.projects.store import PostgresProjects, Project
from app.providers.embeddings import FakeEmbedder
from app.providers.stt.base import FakeSttAdapter
from app.router import InMemoryQuotaStore, load_config
from app.search.index import DocRef, PostgresIndex
from app.services import build_services, set_services

SECRET = "super-secret-jwt-token-with-at-least-32-characters"
LIVE = [
    ("0", "Let's review the payments release plan."),
    ("1", "Sai, when does the payments cluster deploy?"),
    ("0", "Rollback steps are in the runbook."),
]


def h(user: str, email: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(user, email=email)}"}


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
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
        for u, e in [
            ("owner", "o@x.io"),
            ("member", "m@x.io"),
            ("viewer", "v@x.io"),
            ("outsider", "z@x.io"),
        ]:
            client.portal.call(s.projects.register_user, u, e)
        pid = client.post(
            "/projects", json={"name": "Payments", "description": "Q4"}, headers=h("owner")
        ).json()["id"]
        assert client.post(
            f"/projects/{pid}/members",
            json={"email": "M@x.io", "role": "member"},
            headers=h("owner"),
        ).json() == {"status": "added", "email_sent": False}
        client.post(
            f"/projects/{pid}/members",
            json={"email": "v@x.io", "role": "viewer"},
            headers=h("owner"),
        )
        yield s, store, client, pid
    set_services(None)


def test_projects_crud_and_roles(env) -> None:
    s, _, client, pid = env
    assert [p["role"] for p in client.get("/projects", headers=h("member")).json()] == ["member"]
    assert client.get("/projects", headers=h("outsider")).json() == []
    assert client.get(f"/projects/{pid}", headers=h("outsider")).status_code == 404
    assert (
        client.patch(f"/projects/{pid}", json={"name": "x"}, headers=h("member")).status_code == 403
    )
    assert (
        client.patch(f"/projects/{pid}", json={"name": "Payments team"}, headers=h("owner")).json()[
            "name"
        ]
        == "Payments team"
    )
    roster = {
        m["email"]: (m["role"], m["pending"])
        for m in client.get(f"/projects/{pid}/members", headers=h("viewer")).json()
    }
    assert roster == {
        "o@x.io": ("owner", False),
        "m@x.io": ("member", False),
        "v@x.io": ("viewer", False),
    }
    # A project always keeps an owner.
    assert (
        client.patch(
            f"/projects/{pid}/members/owner", json={"role": "member"}, headers=h("owner")
        ).status_code
        == 409
    )
    assert client.delete(f"/projects/{pid}/members/owner", headers=h("owner")).status_code == 409
    assert (
        client.patch(
            f"/projects/{pid}/members/member", json={"role": "viewer"}, headers=h("member")
        ).status_code
        == 403
    )
    # Viewers read; they can't add meetings.
    assert (
        client.post(
            "/meetings", json={"title": "x", "project_id": pid}, headers=h("viewer")
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/meetings", json={"title": "x", "visibility": "project"}, headers=h("member")
        ).status_code
        == 422
    )


def test_invites_for_new_people_are_accepted_when_they_sign_in(env) -> None:
    s, _, client, pid = env
    r = client.post(
        f"/projects/{pid}/members", json={"email": "new@x.io", "role": "member"}, headers=h("owner")
    ).json()
    assert r == {"status": "invited", "email_sent": False}  # no Supabase service key in tests
    pending = [
        m for m in client.get(f"/projects/{pid}/members", headers=h("owner")).json() if m["pending"]
    ]
    assert pending == [
        {"user_id": None, "email": "new@x.io", "name": None, "role": "member", "pending": True}
    ]
    token = jwt.encode(
        {
            "sub": "newbie",
            "role": "authenticated",
            "aud": "authenticated",
            "email": "New@x.io",
            "exp": int(time.time()) + 600,
        },
        SECRET,
        algorithm="HS256",
    )
    backend = client.post("/auth/session", json={"access_token": token}).json()["token"]
    projects = client.get("/projects", headers={"Authorization": f"Bearer {backend}"}).json()
    assert [(p["id"], p["role"]) for p in projects] == [(pid, "member")]
    assert not [
        m for m in client.get(f"/projects/{pid}/members", headers=h("owner")).json() if m["pending"]
    ]


async def test_invite_email_goes_through_supabase_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["key"] = str(req.url), req.headers["apikey"]
        return httpx.Response(200, json={"id": "x"})

    monkeypatch.setenv("SUPABASE_URL", "http://supa")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    assert await send_invite_email("a@b.c", transport=httpx.MockTransport(handler))
    assert seen == {"url": "http://supa/auth/v1/invite", "key": "service"}
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    assert not await send_invite_email("a@b.c")


def _meeting(client, user: str, pid: str | None, visibility: str = "private") -> dict:
    r = client.post(
        "/meetings",
        json={
            "type": "review",
            "title": "Release review",
            "project_id": pid,
            "visibility": visibility,
        },
        headers=h(user),
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_sharing_a_meeting_with_the_project(env) -> None:
    s, store, client, pid = env
    m = _meeting(client, "owner", pid)
    mid = m["meeting_id"]
    client.portal.call(
        store.add_segment,
        Segment(mid, "seg_1", "system", "spk_0", "We ship Thursday.", 0, 1000, "x"),
    )
    client.post(f"/meetings/{mid}/end", headers=h("owner"))
    assert client.get(f"/meetings/{mid}", headers=h("member")).status_code == 404  # still private
    assert mid not in {x["id"] for x in client.get("/meetings", headers=h("member")).json()}

    assert (
        client.patch(
            f"/meetings/{mid}", json={"visibility": "project"}, headers=h("member")
        ).status_code
        == 404
    )
    out = client.patch(
        f"/meetings/{mid}", json={"visibility": "project"}, headers=h("owner")
    ).json()
    assert out["visibility"] == "project" and out["is_mine"] is True
    listed = {x["id"]: x for x in client.get("/meetings", headers=h("viewer")).json()}
    assert listed[mid]["is_mine"] is False
    detail = client.get(f"/meetings/{mid}", headers=h("viewer")).json()
    assert [t["text"] for t in detail["transcript"]] == ["We ship Thursday."]
    for path in [f"/meetings/{mid}/summary", f"/meetings/{mid}/export"]:
        assert client.get(path, headers=h("member")).status_code == 200
    # Shared means readable, not writable: only the owner changes it. Cards stay private.
    assert (
        client.post(f"/meetings/{mid}/summary/regenerate", json={}, headers=h("member")).status_code
        == 404
    )
    assert (
        client.post(
            f"/meetings/{mid}/speakers/spk_0/rename",
            json={"display_name": "x"},
            headers=h("member"),
        ).status_code
        == 404
    )
    assert client.get(f"/meetings/{mid}/cards", headers=h("member")).status_code == 404
    assert client.get(f"/meetings/{mid}", headers=h("outsider")).status_code == 404
    # Moving it out of the project makes it private again.
    assert (
        client.patch(f"/meetings/{mid}", json={"project_id": ""}, headers=h("owner")).json()[
            "visibility"
        ]
        == "private"
    )
    assert client.get(f"/meetings/{mid}", headers=h("member")).status_code == 404


def test_members_watch_a_shared_meeting_live_but_never_see_the_owners_cards(env) -> None:
    _, _, client, pid = env
    client.put("/me/profile", json={"name": "Sai"}, headers=h("owner"))
    m = _meeting(client, "owner", pid, "project")
    mid = m["meeting_id"]
    assert client.post(f"/meetings/{mid}/watch", headers=h("outsider")).status_code == 404
    w = client.post(f"/meetings/{mid}/watch", headers=h("member")).json()
    assert w["ws_url"].endswith(f"/ws/meetings/{mid}/watch")
    # The member can't use the watch token to send audio as the owner.
    with client.websocket_connect(f"/ws/meetings/{mid}?token={w['ws_token']}") as bad:
        with pytest.raises(WebSocketDisconnect):
            bad.receive_json()
    with client.websocket_connect(f"/ws/meetings/{mid}?token={m['ws_token']}") as owner_ws:
        owner_ws.receive_json()
        with client.websocket_connect(f"/ws/meetings/{mid}/watch?token={w['ws_token']}") as watch:
            assert watch.receive_json()["type"] == "meeting.started"
            for _ in range(len(LIVE) * 50 + 5):
                owner_ws.send_bytes(b"\x01" + b"\x00" * 640)
            owner_events = []
            while sum(e["type"] == "card.created" for e in owner_events) < 1 or sum(
                e["type"] == "transcript.final" for e in owner_events
            ) < len(LIVE):
                owner_events.append(owner_ws.receive_json())
            seen = []
            while sum(e["type"] == "transcript.final" for e in seen) < len(LIVE):
                seen.append(watch.receive_json())
            assert [e["text"] for e in seen if e["type"] == "transcript.final"] == [
                t for _, t in LIVE
            ]
            # The owner got a card and a detected question; the watcher got neither.
            assert {"card.created", "question.detected"} <= {e["type"] for e in owner_events}
            assert not {e["type"] for e in seen} & {
                "card.created",
                "card.delta",
                "question.detected",
            }
            client.post(f"/meetings/{mid}/end", headers=h("owner"))
            # After the meeting, the watcher hears when the summary is ready.
            while (e := watch.receive_json())["type"] != "summary.ready":
                assert e["type"] not in {"card.created", "question.detected"}
    assert client.get(f"/meetings/{mid}/summary", headers=h("member")).json()["status"] == "ready"
    private = _meeting(client, "owner", pid)
    assert (
        client.post(f"/meetings/{private['meeting_id']}/watch", headers=h("member")).status_code
        == 404
    )


def test_project_vocabulary_feeds_new_meetings(env) -> None:
    s, store, client, pid = env
    assert (
        client.put(
            f"/projects/{pid}/vocabulary",
            json={"terms": ["ArgoCD = GitOps tool", " ", "OPS-142"]},
            headers=h("viewer"),
        ).status_code
        == 403
    )
    terms = client.put(
        f"/projects/{pid}/vocabulary",
        json={"terms": ["ArgoCD = GitOps tool", " ", "OPS-142"]},
        headers=h("member"),
    ).json()["terms"]
    assert terms == ["ArgoCD = GitOps tool", "OPS-142"]
    m = client.post(
        "/meetings",
        json={"title": "x", "project_id": pid, "vocabulary": ["Priya"]},
        headers=h("member"),
    ).json()
    meeting = client.portal.call(store.get, m["meeting_id"])
    assert meeting.vocabulary == sorted(["ArgoCD = GitOps tool", "OPS-142", "Priya"])


def test_documents_ground_search_and_answers_for_members_only(env) -> None:
    s, _, client, pid = env
    runbook = b"# Payments runbook\n\nRollback: run `argocd app rollback payments` and page the on-call SRE.\n"
    r = client.post(
        f"/projects/{pid}/documents",
        files={"file": ("runbook.md", runbook, "text/markdown")},
        data={"title": "Payments runbook"},
        headers=h("member"),
    )
    assert r.status_code == 201 and r.json()["chunks"] == 1
    doc_id = r.json()["id"]
    assert (
        client.post(
            f"/projects/{pid}/documents",
            files={"file": ("x.exe", b"MZ", "application/octet-stream")},
            headers=h("member"),
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/projects/{pid}/documents",
            files={"file": ("a.md", b"x", "text/markdown")},
            headers=h("viewer"),
        ).status_code
        == 403
    )

    def page(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            html="<html><title>Release checklist</title><body><p>Freeze deploys on Fridays.</p></body></html>",
        )

    s.link_transport = httpx.MockTransport(page)
    link = client.post(
        f"/projects/{pid}/links", json={"url": "https://wiki.example/release"}, headers=h("member")
    ).json()
    assert (
        link["title"] == "Release checklist"
        and link["source_url"] == "https://wiki.example/release"
    )
    assert (
        client.post(
            f"/projects/{pid}/links", json={"url": "ftp://x"}, headers=h("member")
        ).status_code
        == 422
    )

    hits = client.get("/search", params={"q": "rollback payments"}, headers=h("viewer")).json()
    assert hits[0]["document_id"] == doc_id and hits[0]["source_type"] == "document"
    assert (
        client.get("/search", params={"q": "rollback payments"}, headers=h("outsider")).json() == []
    )
    answer = client.post(
        "/ask", json={"question": "How do we rollback payments?"}, headers=h("member")
    ).json()
    assert answer["found"] and answer["citations"][0]["document_id"] == doc_id
    titles = [
        d["title"] for d in client.get(f"/projects/{pid}/documents", headers=h("viewer")).json()
    ]
    assert titles == ["Payments runbook", "Release checklist"]
    assert (
        client.delete(f"/projects/{pid}/documents/{doc_id}", headers=h("viewer")).status_code == 403
    )
    assert (
        client.delete(f"/projects/{pid}/documents/{doc_id}", headers=h("member")).status_code == 204
    )
    remaining = client.get("/search", params={"q": "rollback payments"}, headers=h("member")).json()
    assert doc_id not in {x["document_id"] for x in remaining}


def test_action_item_board(env) -> None:
    s, store, client, pid = env
    client.put("/me/profile", json={"name": "Priya"}, headers=h("member"))
    shared = _meeting(client, "owner", pid, "project")["meeting_id"]
    private = _meeting(client, "owner", pid)["meeting_id"]
    ms = {mid: client.portal.call(store.get, mid) for mid in (shared, private)}
    items = [
        ActionItemRecord(new_id(), shared, "Add retry metrics", "Priya", "2020-01-01"),
        ActionItemRecord(new_id(), shared, "Update runbook", "Sai", "2999-01-01"),
        ActionItemRecord(new_id(), private, "Private thing", "Priya"),
    ]
    for i in items:
        client.portal.call(store.add_action_item, ms[i.meeting_id], i)

    def board(f: str, u: str = "member") -> list[str]:
        params = {"project_id": pid, "filter": f}
        return [x["text"] for x in client.get("/action-items", params=params, headers=h(u)).json()]

    assert board("all") == ["Add retry metrics", "Update runbook"]
    assert board("mine") == ["Add retry metrics"]
    assert board("overdue") == ["Add retry metrics"]
    assert (
        client.get("/action-items", params={"project_id": pid}, headers=h("outsider")).status_code
        == 404
    )
    r = client.patch(f"/action-items/{items[0].id}", json={"status": "done"}, headers=h("member"))
    assert r.json()["status"] == "done" and r.json()["overdue"] is False
    assert (
        client.patch(
            f"/action-items/{items[1].id}", json={"status": "done"}, headers=h("viewer")
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/action-items/{items[2].id}", json={"status": "done"}, headers=h("member")
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/action-items/{items[1].id}",
            json={"owner": "Priya", "due": "2026-12-01"},
            headers=h("owner"),
        ).json()["owner"]
        == "Priya"
    )


def test_leaving_and_deleting_a_project(env) -> None:
    s, store, client, pid = env
    from app.voiceprints import seal

    client.portal.call(s.speakers.enroll, "member", pid, "Priya", seal([1.0, 0.0]))
    assert (
        client.delete(f"/projects/{pid}/members/member", headers=h("member")).status_code == 204
    )  # leave
    assert client.portal.call(s.speakers.mine, "member") == []  # voiceprint gone with membership
    assert client.get(f"/projects/{pid}", headers=h("member")).status_code == 404
    mid = _meeting(client, "owner", pid, "project")["meeting_id"]
    assert client.delete(f"/projects/{pid}", headers=h("viewer")).status_code == 403
    assert client.delete(f"/projects/{pid}", headers=h("owner")).status_code == 204
    m = client.portal.call(store.get, mid)
    assert (m.project_id, m.visibility) == (None, "private")
    assert client.get("/projects", headers=h("owner")).json() == []


async def test_postgres_projects_invites_documents_and_search(pg_dsn: str) -> None:
    owner, member, outsider = (str(uuid.UUID(int=i)) for i in (51, 52, 53))
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        for u, e in [(owner, "o@x.io"), (member, "m@x.io"), (outsider, "z@x.io")]:
            c.execute("insert into auth.users (id, email) values (%s, %s)", (u, e))
            c.execute("insert into public.users (id, email) values (%s, %s)", (u, e))
    store = PostgresStore(pg_dsn)
    projects = PostgresProjects(store)
    p = await projects.create(Project(str(uuid.uuid4()), "P", owner, vocabulary=["ArgoCD"]))
    assert await projects.role(p.id, owner) == "owner"  # trigger made the creator owner
    assert await projects.user_by_email("M@X.IO") == member
    await projects.add_invite(p.id, "m@x.io", "viewer", owner)
    assert await projects.invites_for_project(p.id) == [("m@x.io", "viewer")]
    assert await projects.accept_invites(member, "m@x.io") == [p.id]
    assert await projects.role(p.id, member) == "viewer"
    assert [m.email for m in await projects.member_list(p.id)] == ["o@x.io", "m@x.io"]
    p.name = "Renamed"
    await projects.update(p)
    assert (await projects.get(p.id)).name == "Renamed"
    assert [x.name for x, _r in await projects.for_user(member)] == ["Renamed"]

    docs, index, emb = PostgresDocuments(store), PostgresIndex(store), FakeEmbedder()
    d = await docs.add(Document(str(uuid.uuid4()), p.id, "Runbook", owner, storage_path="x"))
    chunks = document_chunks(d, "Rollback with argocd app rollback payments.")
    await index.replace_document(
        DocRef(d.id, p.id, d.title, owner, d.created_at),
        chunks,
        await emb.embed([c.text for c in chunks]),
    )
    [v] = await emb.embed(["rollback payments"])
    hits = await index.search(member, "rollback payments", v)
    assert (
        hits
        and hits[0].document_id == d.id
        and hits[0].title == "Runbook"
        and hits[0].meeting_id == ""
    )
    assert await index.search(outsider, "rollback payments", v) == []
    # Shared meetings appear in members' lists; leaving the project removes access.
    m = Meeting(new_id(), owner, "review", "Shared", "cloud", "project", p.id)
    await store.create(m)
    assert [x.id for x in await store.list_shared([p.id], member)] == [m.id]
    await projects.remove_member(p.id, member)
    assert await projects.role(p.id, member) is None
    await store.detach_project(p.id)
    assert (await store.get(m.id)).visibility == "private"
    await docs.delete(d.id)
    assert await index.search(owner, "rollback payments", v) == []
    await projects.delete(p.id)
    assert await projects.get(p.id) is None
    # RLS: invites are visible to the project owner and to the invited email only.
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        pid2 = str(
            c.execute(
                "insert into projects (name, created_by) values ('Q', %s) returning id", (owner,)
            ).fetchone()[0]
        )
        c.execute(
            "insert into project_invites (project_id, email, role, invited_by) values (%s, 'z@x.io', 'member', %s)",
            (pid2, owner),
        )
    for uid, email, n in [(owner, "o@x.io", 1), (outsider, "z@x.io", 1), (member, "m@x.io", 0)]:
        with psycopg.connect(pg_dsn) as c:
            c.execute("set local role authenticated")
            c.execute(
                "select set_config('request.jwt.claims', %s, true)",
                (f'{{"sub": "{uid}", "role": "authenticated", "email": "{email}"}}',),
            )
            assert len(c.execute("select 1 from project_invites").fetchall()) == n
    await store.close()
