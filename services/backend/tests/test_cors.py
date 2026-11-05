"""The web app calls the backend from a browser: only the origins in COPILOT_WEB_ORIGINS may."""

from __future__ import annotations

import importlib

from fastapi.testclient import TestClient


def make_app(monkeypatch, origins: str):
    monkeypatch.setenv("COPILOT_WEB_ORIGINS", origins)
    import app.main as main

    return importlib.reload(main).app


def test_allowed_web_origin_gets_cors_headers(monkeypatch) -> None:
    app = make_app(monkeypatch, "https://copilot.example.com, https://preview.example.com/")
    with TestClient(app) as c:
        pre = c.options(
            "/meetings",
            headers={
                "Origin": "https://copilot.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert pre.status_code == 200
        assert pre.headers["access-control-allow-origin"] == "https://copilot.example.com"
        assert "access-control-allow-credentials" not in pre.headers
        r = c.get("/health", headers={"Origin": "https://preview.example.com"})
        assert r.headers["access-control-allow-origin"] == "https://preview.example.com"
        other = c.get("/health", headers={"Origin": "https://evil.example.com"})
        assert "access-control-allow-origin" not in other.headers


def test_no_cors_by_default(monkeypatch) -> None:
    app = make_app(monkeypatch, "")
    with TestClient(app) as c:
        r = c.get("/health", headers={"Origin": "https://copilot.example.com"})
        assert "access-control-allow-origin" not in r.headers
    monkeypatch.delenv("COPILOT_WEB_ORIGINS")
    import app.main as main

    importlib.reload(main)
