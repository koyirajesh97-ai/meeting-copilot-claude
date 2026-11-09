import pytest
from fastapi.testclient import TestClient

from app.readiness import check_startup, config_problems, production_mode
from app.router.config import load_config

CFG = load_config()
GOOD = {
    "COPILOT_ENV": "production",
    "BACKEND_SECRET": "b" * 40,
    "VOICEPRINT_KEY": "v" * 40,
    "INTEGRATIONS_KEY": "i" * 40,
    "DATABASE_URL": "postgresql://u:p@db.example.com:5432/postgres",
    "SUPABASE_URL": "https://abc.supabase.co",
    "COPILOT_WEB_ORIGINS": "https://copilot.example.com",
    "GROQ_API_KEY": "gsk_x",
    "MISTRAL_API_KEY": "m",
    "DEEPGRAM_API_KEY": "d",
}


def test_a_complete_production_config_has_no_problems():
    assert config_problems(GOOD, CFG) == []
    assert check_startup(GOOD, CFG) == []


def test_production_refuses_to_start_and_names_what_is_missing():
    env = {k: v for k, v in GOOD.items() if k not in {"DATABASE_URL", "VOICEPRINT_KEY"}}
    env["ALLOW_DEV_LOGIN"] = "1"
    with pytest.raises(RuntimeError) as e:
        check_startup(env, CFG)
    text = str(e.value)
    assert "DATABASE_URL" in text and "VOICEPRINT_KEY" in text and "ALLOW_DEV_LOGIN" in text
    assert "b" * 40 not in text  # values are never echoed


def test_test_mode_and_plain_http_origins_are_refused():
    env = {**GOOD, "COPILOT_FAKE_PROVIDERS": "1", "COPILOT_WEB_ORIGINS": "http://site.example.com"}
    problems = " ".join(config_problems(env, CFG))
    assert "COPILOT_FAKE_PROVIDERS" in problems and "https origins" in problems


def test_essential_tasks_need_a_key_for_a_provider_that_may_see_meeting_data():
    env = {k: v for k, v in GOOD.items() if k not in {"DEEPGRAM_API_KEY", "GROQ_API_KEY"}}
    env["GLADIA_API_KEY"] = "g"  # trains_on_data unknown: doesn't count for meetings
    problems = config_problems(env, CFG)
    assert any(p.startswith("No AI key for stt_live") and "DEEPGRAM_API_KEY" in p for p in problems)
    assert not any("summary" in p for p in problems)  # Mistral covers summaries


def test_outside_production_problems_are_only_warnings():
    env = {"COPILOT_ENV": "development"}
    assert not production_mode(env)
    assert check_startup(env, CFG)  # returned (and logged), not raised


def test_ready_and_security_headers(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app.main import app

    with TestClient(app) as c:
        r = c.get("/ready")
        assert r.status_code == 200 and r.json() == {"status": "ready", "database": "memory"}
        h = c.get("/health").headers
        assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"
        assert "strict-transport-security" not in h  # plain http in tests
        assert (
            "max-age"
            in c.get("/health", headers={"x-forwarded-proto": "https"}).headers[
                "strict-transport-security"
            ]
        )
