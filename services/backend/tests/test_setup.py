"""First-run setup: the free-key wizard tests each key and saves it only on a local backend."""

from __future__ import annotations

import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.setup import save_env
from app.api.setup import test_key as check_key
from app.auth import issue_token
from app.main import app
from app.router import load_config
from app.services import set_services

H = {"Authorization": f"Bearer {issue_token('u1')}"}


@pytest.fixture
def client():
    set_services(None)
    with TestClient(app) as c:
        yield c
    set_services(None)


def test_lists_the_keys_the_backend_needs(client, monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "gsk_x")
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    rows = {r["provider"]: r for r in client.get("/setup/providers", headers=H).json()}
    assert rows["groq"]["has_key"] and not rows["mistral"]["has_key"]
    assert rows["groq"]["required"] and not rows["gemini"]["required"]
    assert rows["groq"]["signup_url"] == "https://console.groq.com/keys"
    assert "local" not in rows and "ollama" not in rows  # nothing to sign up for
    assert client.get("/setup/providers").status_code == 401


def test_a_working_key_is_saved_to_the_local_env_file(client, monkeypatch, tmp_path) -> None:
    env = tmp_path / ".env"
    env.write_text("# keys\nGROQ_API_KEY=\nOTHER=1\n")
    monkeypatch.setenv("COPILOT_ENV_FILE", str(env))
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    bad = client.post(
        "/setup/keys", json={"provider": "groq", "key": "bad-key-bad-key"}, headers=H
    ).json()
    assert bad["ok"] is False and bad["saved"] is False and "GROQ_API_KEY=\n" in env.read_text()
    ok = client.post(
        "/setup/keys", json={"provider": "groq", "key": "gsk_working_key"}, headers=H
    ).json()
    assert ok == {"ok": True, "detail": "ok (Fake mode)", "saved": True, "env_line": None}
    assert env.read_text() == "# keys\nGROQ_API_KEY=gsk_working_key\nOTHER=1\n"
    assert oct(env.stat().st_mode & 0o777) == "0o600"
    assert os.environ["GROQ_API_KEY"] == "gsk_working_key"  # used right away
    assert (
        client.post(
            "/setup/keys", json={"provider": "nope", "key": "12345678"}, headers=H
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/setup/keys", json={"provider": "groq", "key": "has spaces in it"}, headers=H
        ).status_code
        == 422
    )


def test_keys_are_not_saved_without_an_env_file(client, monkeypatch) -> None:
    monkeypatch.delenv("COPILOT_ENV_FILE", raising=False)
    r = client.post(
        "/setup/keys", json={"provider": "mistral", "key": "mistral-key-123"}, headers=H
    ).json()
    assert r["ok"] and not r["saved"] and r["env_line"].startswith("MISTRAL_API_KEY=")


def test_save_env_appends_new_names(tmp_path) -> None:
    p = tmp_path / ".env"
    save_env(p, "A_KEY", "1")
    save_env(p, "A_KEY", "2")
    save_env(p, "B_KEY", "3")
    assert p.read_text() == "A_KEY=2\nB_KEY=3\n"


async def test_real_key_test_uses_the_provider_check(monkeypatch) -> None:
    """Outside Fake mode the key goes into one tiny request and is never left in the environment."""
    monkeypatch.delenv("COPILOT_FAKE_PROVIDERS")
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    seen = []

    class Client(httpx.AsyncClient):
        def __init__(self, *a, **k):
            super().__init__(
                *a,
                **k,
                transport=httpx.MockTransport(
                    lambda r: (
                        seen.append(r.headers["Authorization"]),
                        httpx.Response(401, text="bad"),
                    )[1]
                ),
            )

    monkeypatch.setattr("app.router.check.httpx.AsyncClient", Client)
    ok, detail = await check_key(load_config(), "deepgram", "dg-key-123")
    assert not ok and "401" in detail and seen == ["Token dg-key-123"]
    assert "DEEPGRAM_API_KEY" not in os.environ
