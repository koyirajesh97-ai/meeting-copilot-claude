"""Trace ids from the desktop line up with backend logs; error reports carry no meeting content."""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from app.auth import issue_token
from app.main import app
from app.services import set_services
from app.telemetry import route, scrub_event, trace_id

TP = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


def test_trace_ids_and_routes() -> None:
    assert trace_id(TP) == "4bf92f3577b34da6a3ce929d0e0e4736"
    assert trace_id("00-" + "0" * 32 + "-00f067aa0ba902b7-01") is None
    assert trace_id("garbage") is None and trace_id(None) is None
    assert (
        route("/meetings/5f1c2b3a-1111-4222-8333-444455556666/summary") == "/meetings/{id}/summary"
    )


def test_requests_are_logged_with_the_desktop_trace_id(caplog) -> None:
    set_services(None)
    with TestClient(app) as c, caplog.at_level(logging.INFO, logger="app.http"):
        c.get("/me", headers={"Authorization": f"Bearer {issue_token('u1')}", "traceparent": TP})
    set_services(None)
    assert any(
        "GET /me 200" in r.message and "trace=4bf92f3577b34da6a3ce929d0e0e4736" in r.message
        for r in caplog.records
    )


def test_error_reports_are_scrubbed() -> None:
    event = {
        "request": {
            "method": "POST",
            "url": "http://x/meetings/5f1c2b3a-1111-4222-8333-444455556666/share?x=1",
            "data": "the summary text",
            "headers": {"Authorization": "Bearer t"},
        },
        "user": {"email": "sai@example.com"},
        "extra": {"text": "said in the meeting"},
        "breadcrumbs": {"values": [{"message": "transcript line"}]},
        "exception": {"values": [{"type": "ValueError"}]},
    }
    out = scrub_event(event)
    assert out["request"] == {"method": "POST", "url": "http://x/meetings/{id}/share"}
    assert "user" not in out and "extra" not in out and "breadcrumbs" not in out
    assert out["exception"]["values"][0]["type"] == "ValueError"
