"""Request tracing and opt-in error reporting for the backend.

- Always: each request's W3C `traceparent` (sent by the desktop app) is read and its trace id is
  logged with the route, status and time, so desktop and backend logs line up.
- With OTEL_EXPORTER_OTLP_ENDPOINT set and the `telemetry` extra installed: OpenTelemetry spans
  for every request, continuing the desktop's trace.
- With SENTRY_DSN set and the extra installed: Sentry error reports, without request bodies,
  headers or user details (meeting content never leaves in an error report).
"""

from __future__ import annotations

import logging
import os
import re
import time

from fastapi import FastAPI, Request

log = logging.getLogger("app.http")
TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$")
#: Ids in paths are replaced, so logs and span names never carry meeting or user ids.
_ID = re.compile(r"/[0-9a-f]{8}-[0-9a-f-]{27,}|/[\w%:.-]{20,}")


def trace_id(header: str | None) -> str | None:
    m = TRACEPARENT.match((header or "").strip().lower())
    return m.group(1) if m and m.group(1) != "0" * 32 else None


def route(path: str) -> str:
    return _ID.sub("/{id}", path)


def scrub_event(event: dict, _hint: dict | None = None) -> dict:
    """Sentry before_send: keep the stack trace, drop anything that could hold meeting content."""
    req = event.get("request")
    if isinstance(req, dict):
        event["request"] = {
            "method": req.get("method"),
            "url": route(str(req.get("url", "")).split("?")[0]),
        }
    for key in ("user", "extra", "breadcrumbs"):
        event.pop(key, None)
    return event


def setup(app: FastAPI) -> dict[str, bool]:
    enabled = {"otel": False, "sentry": False}

    @app.middleware("http")
    async def _trace_log(request: Request, call_next):
        t0 = time.perf_counter()
        response = await call_next(request)
        tid = trace_id(request.headers.get("traceparent"))
        if tid and request.url.path != "/health":
            log.info(
                "%s %s %d %.0fms trace=%s",
                request.method,
                route(request.url.path),
                response.status_code,
                (time.perf_counter() - t0) * 1000,
                tid,
            )
        return response

    if os.environ.get("SENTRY_DSN"):
        try:
            import sentry_sdk

            sentry_sdk.init(
                dsn=os.environ["SENTRY_DSN"],
                send_default_pii=False,
                max_request_body_size="never",
                before_send=scrub_event,
                traces_sample_rate=0.0,
            )
            enabled["sentry"] = True
        except ImportError:
            log.warning(
                "SENTRY_DSN is set but sentry-sdk isn't installed (uv sync --extra telemetry)"
            )
    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        try:
            from opentelemetry import trace
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor

            provider = TracerProvider(
                resource=Resource.create({"service.name": "meeting-copilot-backend"})
            )
            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
            trace.set_tracer_provider(provider)
            FastAPIInstrumentor.instrument_app(
                app, tracer_provider=provider, excluded_urls="health"
            )
            enabled["otel"] = True
        except ImportError:
            log.warning(
                "OTEL_EXPORTER_OTLP_ENDPOINT is set but OpenTelemetry isn't installed (uv sync --extra telemetry)"
            )
    return enabled
