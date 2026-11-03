// The live meeting connection: creates the meeting, streams wire frames from the capture's
// outbound buffer over the meeting WebSocket, and turns events into captions and cache rows.
// When the socket drops, audio keeps buffering (60 s) and the connection retries with backoff,
// a fresh token and last_seq, so the server replays what was missed.

import type { MeetingEvent } from "../events";
import type { OutboundAudio } from "../outbound";
import { Emitter } from "./emitter";

export interface LiveState {
  /** off: not recording. connecting/reconnecting: audio is buffered locally meanwhile. */
  status: "off" | "connecting" | "live" | "reconnecting" | "local-only";
  meetingId: string | null;
  message?: string;
}

export interface MeetingSocket {
  meeting_id: string;
  ws_url: string;
  ws_token: string;
}

/** What the connection needs from a backend client. Errors carry an HTTP `status` (0 = offline). */
export interface MeetingApi<O> {
  createMeeting(options: O): Promise<MeetingSocket>;
  wsToken(meetingId: string): Promise<MeetingSocket>;
  endMeeting(meetingId: string): Promise<void>;
}

const statusOf = (err: unknown): number | undefined => (err as { status?: number } | null)?.status;

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15_000];
const PING_MS = 15_000;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const OPEN = 1;

type WebSocketCtor = new (url: string) => WebSocket;

export interface LiveOptions<O> {
  backend: MeetingApi<O>;
  outbound: OutboundAudio;
  WebSocketImpl?: WebSocketCtor;
  backoffMs?: number[];
}

export class LiveConnection<O = unknown> extends Emitter<{ event: [MeetingEvent]; state: [LiveState]; meeting: [string, O] }> {
  private ws: WebSocket | null = null;
  private meetingId: string | null = null;
  private lastSeq = 0;
  private stopped = true;
  private attempt = 0;
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private _state: LiveState = { status: "off", meetingId: null };
  private readonly WS: WebSocketCtor;
  private readonly backoff: number[];

  constructor(private readonly opts: LiveOptions<O>) {
    super();
    this.WS = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor);
    this.backoff = opts.backoffMs ?? BACKOFF_MS;
  }

  get state(): LiveState {
    return this._state;
  }

  get currentMeetingId(): string | null {
    return this.meetingId;
  }

  private set(state: LiveState): void {
    this._state = state;
    this.emit("state", state);
  }

  /** Create the meeting (retrying while the backend is unreachable) and connect. */
  async start(options: O): Promise<void> {
    this.stopped = false;
    this.lastSeq = 0;
    this.attempt = 0;
    this.set({ status: "connecting", meetingId: null });
    while (!this.stopped) {
      try {
        const socket = await this.opts.backend.createMeeting(options);
        this.meetingId = socket.meeting_id;
        this.emit("meeting", socket.meeting_id, options);
        this.open(socket);
        return;
      } catch (err) {
        if (statusOf(err) === 401) {
          this.set({ status: "local-only", meetingId: null, message: "Sign in to get live captions. Recording locally." });
          this.stopped = true;
          return;
        }
        this.set({ status: "connecting", meetingId: null, message: (err as Error).message });
        await this.wait();
      }
    }
  }

  private wait(): Promise<void> {
    const ms = this.backoff[Math.min(this.attempt++, this.backoff.length - 1)];
    return new Promise((r) => {
      this.retry = setTimeout(r, ms);
    });
  }

  private open(socket: MeetingSocket): void {
    const url = `${socket.ws_url}?token=${encodeURIComponent(socket.ws_token)}&last_seq=${this.lastSeq}`;
    const ws = new this.WS(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.set({ status: "live", meetingId: this.meetingId });
      this.opts.outbound.attach((frame) => {
        if (ws.readyState !== OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) return false;
        ws.send(frame);
        return true;
      });
      this.ping = setInterval(() => ws.readyState === OPEN && ws.send(JSON.stringify({ type: "ping" })), PING_MS);
    };
    ws.onmessage = (msg) => {
      if (typeof msg.data !== "string") return;
      let event: MeetingEvent;
      try {
        event = JSON.parse(msg.data) as MeetingEvent;
      } catch {
        return;
      }
      if (typeof event.seq === "number" && event.seq > this.lastSeq) this.lastSeq = event.seq;
      this.emit("event", event);
    };
    ws.onclose = (e) => {
      this.cleanupSocket(ws);
      if (this.stopped) return;
      if (e.code === 4409 || e.code === 4404) {
        this.stopped = true;
        this.set({ status: "local-only", meetingId: this.meetingId, message: `The server closed this meeting (${e.reason || e.code}).` });
        return;
      }
      this.set({ status: "reconnecting", meetingId: this.meetingId, message: "Connection lost; audio is buffered and will be sent on reconnect." });
      void this.reconnect();
    };
    ws.onerror = () => {
      /* onclose follows and handles it */
    };
  }

  private cleanupSocket(ws: WebSocket): void {
    if (this.ws === ws) {
      this.opts.outbound.detach();
      this.ws = null;
    }
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }

  private async reconnect(): Promise<void> {
    while (!this.stopped && this.meetingId) {
      await this.wait();
      if (this.stopped) return;
      try {
        // Socket tokens are short-lived; get a fresh one for every attempt.
        const socket = await this.opts.backend.wsToken(this.meetingId);
        this.open(socket);
        return;
      } catch (err) {
        if (statusOf(err) === 409) {
          this.stopped = true;
          this.set({ status: "local-only", meetingId: this.meetingId, message: "The meeting has ended on the server." });
          return;
        }
        this.set({ status: "reconnecting", meetingId: this.meetingId, message: (err as Error).message });
      }
    }
  }

  /** Send a client message (control or ping). Returns false if not connected. */
  send(message: object): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  /** Wait until queued audio has left, end the meeting on the server, collect trailing finals. */
  async stop(): Promise<string | null> {
    const id = this.meetingId;
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) {
      for (let i = 0; i < 50 && (ws.bufferedAmount > 0 || this.opts.outbound.buffered > 0); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (id) {
      try {
        await this.opts.backend.endMeeting(id);
        // The server flushes the last finals while ending; give them a moment to arrive.
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.warn("[live] couldn't end the meeting on the server:", (err as Error).message);
      }
    }
    if (this.ws) {
      const w = this.ws;
      this.cleanupSocket(w);
      w.close(1000, "meeting ended");
    }
    this.opts.outbound.detach();
    this.meetingId = null;
    this.set({ status: "off", meetingId: null });
    return id;
  }
}
