// Watching someone else's shared meeting live: a read-only socket, reconnecting with last_seq.

import type { MeetingEvent } from "@meeting-copilot/shared";
import { EventEmitter } from "node:events";
import type { BackendClient } from "./client";

const OPEN = 1;

export class WatchConnection extends EventEmitter<{ event: [MeetingEvent]; closed: [string] }> {
  private ws: WebSocket | null = null;
  private meetingId: string | null = null;
  private lastSeq = 0;
  private stopped = true;
  private ping: NodeJS.Timeout | null = null;

  constructor(
    private readonly backend: BackendClient,
    private readonly WS: new (url: string) => WebSocket = globalThis.WebSocket as unknown as new (url: string) => WebSocket,
  ) {
    super();
  }

  async start(meetingId: string): Promise<void> {
    this.stop();
    this.meetingId = meetingId;
    this.lastSeq = 0;
    this.stopped = false;
    await this.open();
  }

  private async open(): Promise<void> {
    if (this.stopped || !this.meetingId) return;
    const t = await this.backend.watchToken(this.meetingId);
    const ws = new this.WS(`${t.ws_url}?token=${encodeURIComponent(t.ws_token)}&last_seq=${this.lastSeq}`);
    this.ws = ws;
    ws.onmessage = (m) => {
      if (typeof m.data !== "string") return;
      const e = JSON.parse(m.data) as MeetingEvent;
      if (e.seq > this.lastSeq) this.lastSeq = e.seq;
      this.emit("event", e);
    };
    ws.onopen = () => {
      this.ping = setInterval(() => ws.readyState === OPEN && ws.send(JSON.stringify({ type: "ping" })), 15_000);
    };
    ws.onclose = (e) => {
      if (this.ping) clearInterval(this.ping);
      if (this.stopped || this.ws !== ws) return;
      if (e.code === 4409 || e.code === 4404) {
        this.stopped = true;
        this.emit("closed", e.reason || "The meeting isn't live");
        return;
      }
      setTimeout(() => void this.open().catch((err) => this.emit("closed", (err as Error).message)), 1000);
    };
  }

  stop(): void {
    this.stopped = true;
    if (this.ping) clearInterval(this.ping);
    this.ws?.close(1000, "stopped watching");
    this.ws = null;
  }
}
