// Request tracing from the desktop to the backend (W3C trace context). Every backend call gets a
// `traceparent` header, so backend logs and traces line up with the app's. When diagnostics are
// on and an OTLP endpoint is configured, the spans (route and timing only, never meeting content)
// are exported as OTLP/HTTP JSON.

import { randomBytes } from "node:crypto";

export interface Span {
  traceId: string;
  spanId: string;
  name: string;
  startMs: number;
  endMs: number;
  status: number;
}

const hex = (n: number) => randomBytes(n).toString("hex");

export function traceparent(): { header: string; traceId: string; spanId: string } {
  const traceId = hex(16);
  const spanId = hex(8);
  return { header: `00-${traceId}-${spanId}-01`, traceId, spanId };
}

/** "/meetings/5f1c.../summary" -> "/meetings/{id}/summary": ids never leave in span names. */
export function routeName(method: string, path: string): string {
  const clean = path.split("?")[0].replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/{id}").replace(/\/[\w%:.-]{20,}/g, "/{id}");
  return `${method} ${clean}`;
}

export function otlpPayload(spans: Span[], version: string): object {
  return {
    resourceSpans: [{
      resource: { attributes: [
        { key: "service.name", value: { stringValue: "meeting-copilot-desktop" } },
        { key: "service.version", value: { stringValue: version } },
      ] },
      scopeSpans: [{
        scope: { name: "meeting-copilot" },
        spans: spans.map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          name: s.name,
          kind: 3, // client
          startTimeUnixNano: String(BigInt(Math.round(s.startMs)) * 1_000_000n),
          endTimeUnixNano: String(BigInt(Math.round(s.endMs)) * 1_000_000n),
          attributes: [{ key: "http.response.status_code", value: { intValue: s.status } }],
          status: { code: s.status >= 500 || s.status === 0 ? 2 : 1 },
        })),
      }],
    }],
  };
}

export class Tracer {
  private queue: Span[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly endpoint: () => string | null,
    private readonly enabled: () => boolean,
    private readonly version: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  record(span: Span): void {
    if (!this.enabled() || !this.endpoint()) return;
    this.queue.push(span);
    if (this.queue.length > 500) this.queue.splice(0, this.queue.length - 500);
    this.timer ??= setTimeout(() => void this.flush(), 10_000);
    this.timer.unref?.();
  }

  async flush(): Promise<number> {
    this.timer = null;
    const url = this.endpoint();
    const spans = this.queue.splice(0);
    if (!url || spans.length === 0) return 0;
    try {
      await this.fetchImpl(`${url.replace(/\/$/, "")}/v1/traces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(otlpPayload(spans, this.version)),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      /* diagnostics are best effort */
    }
    return spans.length;
  }
}
