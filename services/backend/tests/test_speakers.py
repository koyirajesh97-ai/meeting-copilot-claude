"""Voice enrollment (consent, encryption, deletion) and naming enrolled speakers in meetings."""

from __future__ import annotations

import asyncio
import io
import struct
import uuid
import wave

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import voiceprints
from app.auth import issue_token
from app.main import app
from app.meetings.pg import PostgresStore
from app.meetings.speakers import PostgresSpeakers
from app.meetings.store import InMemoryMeetingStore
from app.providers.stt.base import FakeSttAdapter
from app.router import InMemoryQuotaStore, load_config
from app.services import build_services, set_services

from .voices import voice

VOICE = {"A": 110, "B": 190, "C": 290}


def wav(pcm: bytes, rate: int = 16_000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def h(user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(user)}"}


def enroll(
    client,
    user: str,
    v: str,
    name: str,
    *,
    consent="true",
    project_id: str | None = None,
    seconds=12,
):
    data = {"consent": consent, "display_name": name}
    if project_id:
        data["project_id"] = project_id
    return client.post(
        "/speakers/enroll",
        headers=h(user),
        data=data,
        files={"audio": ("me.wav", wav(voice(VOICE[v], seconds, 7)), "audio/wav")},
    )


@pytest.fixture
def env():
    cfg = load_config()
    cfg.speaker_id.min_audio_s = 4  # the fixture's lines are short
    store = InMemoryMeetingStore()
    script = [
        (f"line by {who}", label)
        for _ in range(3)
        for who, label in [("A", "0"), ("B", "1"), ("C", "2")]
    ]
    s = build_services(
        config=cfg,
        store=InMemoryQuotaStore(),
        meetings=store,
        stt_factory=lambda d, _c: FakeSttAdapter(d.id, script, seconds_per_line=3.0),
    )
    set_services(s)
    with TestClient(app) as client:
        yield s, store, client
    set_services(None)


def test_enrollment_needs_explicit_consent_and_valid_audio(env) -> None:
    _, _, client = env
    assert enroll(client, "u1", "A", "Sai", consent="false").status_code == 400
    r = client.post(
        "/speakers/enroll",
        headers=h("u1"),
        data={"display_name": "Sai"},
        files={"audio": ("a.wav", wav(voice(110, 12, 1)), "audio/wav")},
    )
    assert r.status_code == 422  # consent missing entirely
    assert enroll(client, "u1", "A", "Sai", seconds=3).status_code == 422  # too short
    bad_rate = client.post(
        "/speakers/enroll",
        headers=h("u1"),
        data={"consent": "true", "display_name": "Sai"},
        files={"audio": ("a.wav", wav(voice(110, 12, 1)[: 12 * 16000], rate=8000), "audio/wav")},
    )
    assert bad_rate.status_code == 422
    assert (
        client.post(
            "/speakers/enroll",
            headers=h("u1"),
            data={"consent": "true", "display_name": "x"},
            files={"audio": ("a.wav", b"not audio", "audio/wav")},
        ).status_code
        == 422
    )


def test_enroll_list_and_delete_never_expose_the_voiceprint(env) -> None:
    s, _, client = env
    r = enroll(client, "u1", "A", "Sai")
    assert r.status_code == 201
    body = r.json()
    assert set(body) == {"id", "display_name", "project_id", "consent_at"}
    assert client.get("/speakers", headers=h("u1")).json() == [body]
    assert client.get("/speakers", headers=h("u2")).json() == []
    # Re-enrolling replaces the old voiceprint rather than adding another.
    enroll(client, "u1", "A", "Sai K")
    assert [x["display_name"] for x in client.get("/speakers", headers=h("u1")).json()] == ["Sai K"]
    sid = client.get("/speakers", headers=h("u1")).json()[0]["id"]
    assert client.delete(f"/speakers/{sid}", headers=h("u2")).status_code == 404  # not yours
    assert client.delete(f"/speakers/{sid}", headers=h("u1")).status_code == 204
    assert client.get("/speakers", headers=h("u1")).json() == []
    assert s.speakers.rows == {}


def test_voiceprints_are_encrypted(monkeypatch: pytest.MonkeyPatch) -> None:
    vec = [0.1, -0.2, 0.3]
    sealed = voiceprints.seal(vec)
    assert struct.pack("<3f", *vec) not in sealed
    assert voiceprints.unseal(sealed) == pytest.approx(vec)
    from cryptography.fernet import Fernet

    monkeypatch.setenv("VOICEPRINT_KEY", Fernet.generate_key().decode())
    voiceprints._fernet.cache_clear()
    try:
        with pytest.raises(ValueError, match="VOICEPRINT_KEY"):
            voiceprints.unseal(sealed)
    finally:
        monkeypatch.delenv("VOICEPRINT_KEY")
        voiceprints._fernet.cache_clear()


def test_three_voices_two_enrolled_are_named_and_the_third_is_not(env) -> None:
    s, store, client = env
    enroll(client, "u1", "A", "Sai")  # the meeting owner's own voice
    enroll(client, "u2", "B", "Priya", project_id="p1")  # a teammate, in the meeting's project
    m = client.post(
        "/meetings",
        json={"type": "review", "title": "3 voices", "project_id": "p1"},
        headers=h("u1"),
    ).json()
    # Meeting audio: A, B, C speaking in turn, 3 s each, three rounds (matches the fake script).
    pcm = b"".join(voice(VOICE[v], 3, 10 + i) for i in range(3) for v in "ABC")
    frames = [b"\x01" + pcm[i : i + 640] for i in range(0, len(pcm) - 639, 640)]
    identified = {}
    with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
        assert ws.receive_json()["type"] == "meeting.started"
        for f in frames:
            ws.send_bytes(f)
        finals = 0
        while finals < 9:
            e = ws.receive_json()
            finals += e["type"] == "transcript.final"
            if e["type"] == "speaker.identified":
                identified[e["speaker_id"]] = (e["display_name"], e["confidence"])
        ws.send_text('{"type": "ping"}')
    assert client.post(f"/meetings/{m['meeting_id']}/end", headers=h("u1")).status_code == 204
    assert set(identified) == {"spk_0", "spk_1"}
    assert identified["spk_0"][0] == "Sai" and identified["spk_1"][0] == "Priya"
    assert all(conf >= 0.75 for _, conf in identified.values())
    # Names are kept for the transcript and summary; the third voice stays "Speaker 3".
    assert asyncio.run(store.speaker_names(m["meeting_id"])) == {"spk_0": "Sai", "spk_1": "Priya"}

    # Renaming the unknown speaker is text only: no new voiceprint.
    before = len(s.speakers.rows)
    client.post(
        f"/meetings/{m['meeting_id']}/speakers/spk_2/rename",
        json={"display_name": "Guest"},
        headers=h("u1"),
    )
    assert len(s.speakers.rows) == before
    assert (
        client.get(f"/meetings/{m['meeting_id']}", headers=h("u1")).json()["speaker_names"]["spk_2"]
        == "Guest"
    )


def test_voices_from_other_projects_are_not_matched(env) -> None:
    _, _, client = env
    enroll(client, "u2", "B", "Priya", project_id="other-project")
    m = client.post(
        "/meetings", json={"type": "review", "project_id": "p1"}, headers=h("u1")
    ).json()
    pcm = b"".join(voice(VOICE[v], 3, 20 + i) for i in range(3) for v in "ABC")
    with client.websocket_connect(f"/ws/meetings/{m['meeting_id']}?token={m['ws_token']}") as ws:
        ws.receive_json()
        for i in range(0, len(pcm) - 639, 640):
            ws.send_bytes(b"\x01" + pcm[i : i + 640])
        events = [ws.receive_json() for _ in range(18)]
    assert not [e for e in events if e["type"] == "speaker.identified"]


async def test_postgres_voiceprints_consent_replace_and_leaving_a_project(pg_dsn: str) -> None:
    owner, member = str(uuid.UUID(int=21)), str(uuid.UUID(int=22))
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        for u in (owner, member):
            c.execute("insert into auth.users (id) values (%s)", (u,))
            c.execute("insert into public.users (id) values (%s)", (u,))
        pid = str(
            c.execute(
                "insert into projects (name, created_by) values ('P', %s) returning id", (owner,)
            ).fetchone()[0]
        )
        c.execute("insert into project_members values (%s, %s, 'member')", (pid, member))
    store = PostgresStore(pg_dsn)
    sp = PostgresSpeakers(store)
    first = await sp.enroll(member, pid, "Priya", voiceprints.seal([0.5, 0.5]))
    second = await sp.enroll(member, pid, "Priya R", voiceprints.seal([0.6, 0.8]))
    assert first.id != second.id
    assert [s.display_name for s in await sp.mine(member)] == ["Priya R"]
    assert [s.display_name for s in await sp.candidates(owner, pid)] == ["Priya R"]
    assert await sp.candidates(owner, None) == []
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        assert c.execute("select consent_at is not null from speakers").fetchone() == (True,)
        c.execute(
            "delete from project_members where user_id = %s", (member,)
        )  # Priya leaves the project
    assert await sp.mine(member) == []
    await store.close()
