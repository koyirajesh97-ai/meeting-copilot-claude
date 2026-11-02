"""Supabase session exchange, dev login, and meetings + transcripts persisted in Postgres."""

from __future__ import annotations

import time
import uuid
import wave
from pathlib import Path

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app import auth_supabase
from app.main import app
from app.meetings.pg import PostgresStore
from app.providers.stt.base import FakeSttAdapter
from app.router import InMemoryQuotaStore, load_config
from app.services import build_services, set_services

SECRET = "super-secret-jwt-token-with-at-least-32-characters"
FIXTURE = Path(__file__).resolve().parents[3] / "evals" / "fixtures" / "audio" / "speech-16k.wav"


def supabase_token(
    sub: str, *, role: str = "authenticated", exp_in: int = 3600, key=SECRET, alg="HS256", **kw
) -> str:
    claims = {
        "sub": sub,
        "role": role,
        "aud": "authenticated",
        "email": "sai@example.com",
        "exp": int(time.time()) + exp_in,
        **kw,
    }
    return jwt.encode(claims, key, algorithm=alg)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    set_services(build_services(store=InMemoryQuotaStore()))
    yield TestClient(app)
    set_services(None)


def test_supabase_session_becomes_a_backend_token(client: TestClient) -> None:
    uid = str(uuid.uuid4())
    r = client.post("/auth/session", json={"access_token": supabase_token(uid)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == uid and body["email"] == "sai@example.com"
    me = client.get("/me", headers={"Authorization": f"Bearer {body['token']}"}).json()
    assert me == {"id": uid, "email": "sai@example.com"}
    # A Supabase token itself is not a backend token.
    assert (
        client.get("/me", headers={"Authorization": f"Bearer {supabase_token(uid)}"}).status_code
        == 401
    )


@pytest.mark.parametrize(
    "token",
    [
        supabase_token("u", exp_in=-10),
        supabase_token("u", role="anon"),
        supabase_token("u", key="wrong-secret-wrong-secret-wrong-secret!!"),
        "not-a-jwt",
    ],
    ids=["expired", "anon-role", "bad-signature", "garbage"],
)
def test_bad_supabase_tokens_are_refused(client: TestClient, token: str) -> None:
    assert client.post("/auth/session", json={"access_token": token}).status_code == 401


def test_asymmetric_supabase_keys_via_jwks(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    monkeypatch.delenv("SUPABASE_JWT_SECRET")
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    private = ec.generate_private_key(ec.SECP256R1())

    class FakeJwks:
        def get_signing_key_from_jwt(self, _token):
            return type("K", (), {"key": private.public_key()})()

    monkeypatch.setattr(auth_supabase, "_jwks_client", lambda _url: FakeJwks())
    token = supabase_token("u-es", key=private, alg="ES256")
    assert client.post("/auth/session", json={"access_token": token}).json()["user_id"] == "u-es"


def test_dev_login_is_off_unless_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert client.post("/auth/dev-session").status_code == 404
    assert client.get("/health").json()["dev_login"] is False
    monkeypatch.setenv("ALLOW_DEV_LOGIN", "1")
    r = client.post("/auth/dev-session")
    assert r.status_code == 200 and r.json()["email"] == "dev@localhost"
    assert client.get("/health").json()["dev_login"] is True


def test_meetings_and_transcripts_persist_in_postgres(
    pg_dsn: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    uid = str(uuid.uuid4())
    with psycopg.connect(pg_dsn, autocommit=True) as c:  # Supabase Auth creates this row on sign-up
        c.execute("insert into auth.users (id, email) values (%s, 'sai@example.com')", (uid,))

    def boot() -> tuple[TestClient, PostgresStore]:
        store = PostgresStore(pg_dsn)
        set_services(
            build_services(
                config=load_config(),
                store=InMemoryQuotaStore(),
                meetings=store,
                stt_factory=lambda d, _c: FakeSttAdapter(
                    d.id, [("we ship thursday", "1"), ("sounds good", "0")]
                ),
            )
        )
        return TestClient(app), store

    try:
        client, _ = boot()
        token = client.post("/auth/session", json={"access_token": supabase_token(uid)}).json()[
            "token"
        ]
        h = {"Authorization": f"Bearer {token}"}
        m = client.post(
            "/meetings", json={"type": "review", "title": "Sprint review"}, headers=h
        ).json()
        with wave.open(str(FIXTURE)) as w:
            pcm = w.readframes(w.getnframes())
        with client.websocket_connect(
            f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}"
        ) as ws:
            ws.receive_json()
            for i in range(0, 640 * 125, 640):  # 2.5 s
                ws.send_bytes(b"\x01" + pcm[i : i + 640])
            while ws.receive_json()["type"] != "transcript.final":
                pass
            for i in range(640 * 125, 640 * 250, 640):
                ws.send_bytes(b"\x01" + pcm[i : i + 640])
            while (e := ws.receive_json())["type"] != "transcript.final":
                pass
            assert e["text"] == "sounds good"
        assert client.post(f"/meetings/{m['meeting_id']}/end", headers=h).status_code == 204

        # "Restart" the backend: a fresh process state reading the same database.
        client, _ = boot()
        listed = client.get("/meetings", headers=h).json()
        assert [x["title"] for x in listed] == ["Sprint review"]
        assert listed[0]["ended_at"] is not None
        detail = client.get(f"/meetings/{m['meeting_id']}", headers=h).json()
        assert [(s["text"], s["speaker_id"], s["channel"]) for s in detail["transcript"]] == [
            ("we ship thursday", "spk_1", "system"),
            ("sounds good", "spk_0", "system"),
        ]
        stranger = str(uuid.uuid4())
        with psycopg.connect(pg_dsn, autocommit=True) as c:
            c.execute(
                "insert into auth.users (id, email) values (%s, 'z@example.com')", (stranger,)
            )
        other_token = client.post(
            "/auth/session", json={"access_token": supabase_token(stranger)}
        ).json()["token"]
        other = {"Authorization": f"Bearer {other_token}"}
        assert client.get(f"/meetings/{m['meeting_id']}", headers=other).status_code == 404
        assert client.get("/meetings", headers=other).json() == []

        with psycopg.connect(pg_dsn) as c:
            row = c.execute("select email from public.users where id = %s", (uid,)).fetchone()
            assert row == ("sai@example.com",)
    finally:
        set_services(None)


def test_dev_login_works_with_postgres(pg_dsn: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOW_DEV_LOGIN", "1")
    set_services(build_services(store=InMemoryQuotaStore(), meetings=PostgresStore(pg_dsn)))
    try:
        client = TestClient(app)
        token = client.post("/auth/dev-session").json()["token"]
        r = client.post(
            "/meetings", json={"title": "Dev"}, headers={"Authorization": f"Bearer {token}"}
        )
        assert r.status_code == 201
    finally:
        set_services(None)
