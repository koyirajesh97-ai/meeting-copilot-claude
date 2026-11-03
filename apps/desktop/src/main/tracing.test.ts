import { describe, expect, it } from "vitest";
import { applySettingsPatch } from "./settingsSanitize";
import { DEFAULT_SETTINGS } from "../shared/ipc";
import { otlpPayload, routeName, traceparent, Tracer } from "./tracing";

describe("tracing", () => {
  it("makes W3C trace headers and id-free span names", () => {
    const t = traceparent();
    expect(t.header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(t.header).toContain(t.traceId);
    expect(routeName("GET", "/meetings/5f1c2b3a-1111-4222-8333-444455556666/summary?x=1")).toBe("GET /meetings/{id}/summary");
    expect(routeName("POST", "/integrations/google/connect")).toBe("POST /integrations/google/connect");
  });

  it("exports spans only with diagnostics on and an endpoint set", async () => {
    const sent: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => (sent.push({ url, body: String(init.body) }), new Response(""))) as typeof fetch;
    let on = false;
    const tracer = new Tracer(() => "http://collector:4318", () => on, "0.1.0", fetchImpl);
    const span = { traceId: "a".repeat(32), spanId: "b".repeat(16), name: "GET /me", startMs: 1000, endMs: 1042, status: 200 };
    tracer.record(span);
    expect(await tracer.flush()).toBe(0);
    on = true;
    tracer.record(span);
    expect(await tracer.flush()).toBe(1);
    expect(sent[0].url).toBe("http://collector:4318/v1/traces");
    const s = JSON.parse(sent[0].body).resourceSpans[0].scopeSpans[0].spans[0];
    expect(s).toMatchObject({ name: "GET /me", startTimeUnixNano: "1000000000", endTimeUnixNano: "1042000000", status: { code: 1 } });
    expect(JSON.stringify(otlpPayload([{ ...span, status: 0 }], "x"))).toContain('"code":2');
  });

  it("new settings: updates on, diagnostics off, validated", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ autoUpdate: true, diagnostics: false, setupDone: false, defaultMode: "cloud" });
    const s = applySettingsPatch(DEFAULT_SETTINGS, { diagnostics: "yes", defaultMode: "evil", setupDone: true, autoUpdate: false });
    expect(s).toMatchObject({ diagnostics: false, defaultMode: "cloud", setupDone: true, autoUpdate: false });
  });
});
