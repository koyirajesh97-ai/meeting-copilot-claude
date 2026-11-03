import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { DEFAULT_SETTINGS, type LiveState } from "../../shared/ipc";
import { OutboundAudio } from "@meeting-copilot/shared";
import { defaultStartOptions, sanitizeStartOptions } from "../startOptions";
import { AuthManager, type SecretBox } from "./auth";
import { Cache } from "./cache";
import { BackendClient, BackendError, type MeetingSocket, type SessionOut } from "./client";
import { LiveConnection } from "./live";
import { syncAll } from "./sync";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "copilot-backend-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const seg = (id: string, start: number, text = id) => ({
  segment_id: id, channel: "system" as const, speaker_id: "spk_0", text, start_ms: start, end_ms: start + 500,
});

describe("local cache", () => {
  it("keeps meetings and transcripts across reopen", () => {
    const path = join(dir, "cache.sqlite");
    let c = new Cache(path);
    c.upsertMeeting({ id: "m1", title: "Standup", type: "standup", mode: "cloud", started_at: 100, ended_at: null });
    c.upsertSegment("m1", seg("seg_2", 2000));
    c.upsertSegment("m1", seg("seg_1", 1000));
    c.upsertSegment("m1", seg("seg_1", 1000, "edited")); // replay/sync upserts, never duplicates
    c.markEnded("m1", 200);
    c.close();
    c = new Cache(path);
    expect(c.listMeetings()).toEqual([
      {
        id: "m1", title: "Standup", type: "standup", mode: "cloud", started_at: 100, ended_at: 200, segment_count: 2,
        is_mine: true, is_live: false, visibility: "private", project_id: null,
      },
    ]);
    expect(c.getMeeting("m1")!.transcript.map((s) => s.text)).toEqual(["edited", "seg_2"]);
    expect(c.getMeeting("nope")).toBeNull();
    c.close();
  });

  it("knows which meetings need syncing", () => {
    const c = new Cache(join(dir, "c.sqlite"));
    c.upsertMeeting({ id: "a", title: "a", type: "custom", mode: "cloud", started_at: 1, ended_at: 5 });
    c.upsertMeeting({ id: "b", title: "b", type: "custom", mode: "cloud", started_at: 2, ended_at: null });
    c.markSynced("a", 10);
    expect(c.unsyncedMeetingIds()).toEqual(["b"]);
    c.close();
  });
});

describe("projects", () => {
  it("stores who owns a cached meeting, and migrates an old cache", async () => {
    const path = join(dir, "old.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    const old = new DatabaseSync(path);
    old.exec("create table meetings (id text primary key, title text not null, type text not null, mode text not null, started_at real not null, ended_at real, synced_at real)");
    old.exec("insert into meetings values ('old', 'Old', 'custom', 'cloud', 1, 2, null)");
    old.close();
    const c = new Cache(path);
    expect(c.getMeeting("old")!.is_mine).toBe(true);
    c.upsertMeeting({ id: "s", title: "Theirs", type: "review", mode: "cloud", started_at: 3, ended_at: null, is_mine: false, is_live: true, visibility: "project", project_id: "p1" });
    expect(c.listMeetings()[0]).toMatchObject({ id: "s", is_mine: false, is_live: true, visibility: "project", project_id: "p1" });
    c.close();
  });

  it("maps each projects call to one backend route and rejects odd ids", async () => {
    const { projectCall } = await import("./projects");
    const seen: string[] = [];
    const backend = {
      call: async (method: string, path: string, body?: unknown) => (seen.push(`${method} ${path} ${JSON.stringify(body ?? null)}`), []),
      upload: async (path: string, form: FormData) => (seen.push(`UPLOAD ${path} ${(form.get("file") as File).name}`), {}),
    } as never;
    const file = join(dir, "runbook.md");
    (await import("node:fs")).writeFileSync(file, "# Runbook");
    await projectCall(backend, { op: "invite", id: "p1", email: "a@b.co", role: "viewer" }, async () => null);
    await projectCall(backend, { op: "board", id: "p1", filter: "overdue" }, async () => null);
    await projectCall(backend, { op: "editItem", itemId: "i1", status: "done" }, async () => null);
    expect(await projectCall(backend, { op: "uploadDocument", id: "p1" }, async () => null)).toBeNull(); // dialog cancelled
    await projectCall(backend, { op: "uploadDocument", id: "p1" }, async () => file);
    expect(seen).toEqual([
      'POST /projects/p1/members {"email":"a@b.co","role":"viewer"}',
      "GET /action-items?project_id=p1&filter=overdue null",
      'PATCH /action-items/i1 {"status":"done"}',
      "UPLOAD /projects/p1/documents runbook.md",
    ]);
    await expect(projectCall(backend, { op: "get", id: "../admin" }, async () => null)).rejects.toThrow("Bad id");
  });

  it("deleting a meeting returns its recording folder; clearAll empties the cache", () => {
    const c = new Cache(join(dir, "d.sqlite"));
    c.upsertMeeting({ id: "m1", title: "a", type: "custom", mode: "cloud", started_at: 1, ended_at: 2 });
    c.setRecordingDir("m1", "/rec/2026-11-02");
    c.upsertSegment("m1", seg("seg_1", 0));
    c.upsertMeeting({ id: "m2", title: "b", type: "custom", mode: "cloud", started_at: 3, ended_at: 4 });
    expect(c.deleteMeeting("m1")).toBe("/rec/2026-11-02");
    expect(c.getMeeting("m1")).toBeNull();
    expect(c.deleteMeeting("m2")).toBeNull();
    c.upsertMeeting({ id: "m3", title: "c", type: "custom", mode: "cloud", started_at: 5, ended_at: 6 });
    c.clearAll();
    expect(c.listMeetings()).toEqual([]);
    c.close();
  });

  it("Local-only only connects to a backend on this computer", async () => {
    const { isLoopbackUrl, liveConnectionAllowed } = await import("../startOptions");
    expect(["http://127.0.0.1:8000", "http://localhost:8000", "http://[::1]:8000"].every(isLoopbackUrl)).toBe(true);
    expect(["https://api.example.com", "http://127.example.com", "http://localhost.evil.com", "nonsense"].some(isLoopbackUrl)).toBe(false);
    expect(liveConnectionAllowed("local", "https://copilot.example.com")).toMatchObject({ ok: false });
    expect(liveConnectionAllowed("local", "http://127.0.0.1:8000")).toEqual({ ok: true });
    expect(liveConnectionAllowed("cloud", "https://copilot.example.com")).toEqual({ ok: true });
  });

  it("only shares a meeting that has a project", () => {
    const now = new Date();
    expect(sanitizeStartOptions({ title: "x", visibility: "project", project_id: "p1" }, now)).toMatchObject({ visibility: "project", project_id: "p1" });
    expect(sanitizeStartOptions({ title: "x", visibility: "project", project_id: "../x" }, now)).toMatchObject({ visibility: "private", project_id: null });
  });
});

describe("sync worker", () => {
  it("pulls new and newly ended meetings with their transcripts", async () => {
    const c = new Cache(join(dir, "c.sqlite"));
    c.upsertMeeting({ id: "m1", title: "old", type: "custom", mode: "cloud", started_at: 1, ended_at: null });
    c.markSynced("m1", 2);
    const server = {
      listMeetings: async () => [
        { id: "m1", title: "Renamed", type: "custom", mode: "cloud", visibility: "private", started_at: 1, ended_at: 9 },
        { id: "m2", title: "New", type: "review", mode: "cloud", visibility: "private", started_at: 3, ended_at: 4 },
      ],
      getMeeting: async (id: string) => ({
        id, title: id === "m1" ? "Renamed" : "New", type: "custom", mode: "cloud", visibility: "private",
        started_at: 1, ended_at: 9, transcript: [seg("seg_1", 0, `${id} line`)],
      }),
    } as unknown as BackendClient;
    expect(await syncAll(server, c)).toBe(2);
    expect(c.listMeetings().map((m) => [m.id, m.title, m.segment_count])).toEqual([
      ["m2", "New", 1],
      ["m1", "Renamed", 1],
    ]);
    c.close();
  });

  it("drops meetings the server deleted, but keeps ones never uploaded", async () => {
    const c = new Cache(join(dir, "c.sqlite"));
    c.upsertMeeting({ id: "gone", title: "deleted elsewhere", type: "custom", mode: "cloud", started_at: 1, ended_at: 2 });
    c.setRecordingDir("gone", "/rec/gone");
    c.markSynced("gone", 3);
    c.upsertMeeting({ id: "offline", title: "not uploaded yet", type: "custom", mode: "cloud", started_at: 4, ended_at: null });
    const server = { listMeetings: async () => [] } as unknown as BackendClient;
    const removed: string[] = [];
    await syncAll(server, c, (d) => removed.push(d));
    expect(c.listMeetings().map((m) => m.id)).toEqual(["offline"]);
    expect(removed).toEqual(["/rec/gone"]);
    c.close();
  });
});

describe("start options", () => {
  it("validates what the renderer sends", () => {
    const now = new Date("2026-11-02T09:00:00Z");
    expect(sanitizeStartOptions({ title: "  Standup ", type: "standup", mode: "local", visibility: "project" }, now)).toEqual({
      title: "Standup", type: "standup", mode: "local", visibility: "private", agenda: "", project_id: null,
    });
    expect(sanitizeStartOptions({ type: "party", mode: "evil" }, now)).toEqual(defaultStartOptions(now));
    expect(sanitizeStartOptions("junk", now).title).toContain("Meeting");
  });
});

class MemorySecrets implements SecretBox {
  data = new Map<string, string>();
  get(n: string) {
    return this.data.get(n) ?? null;
  }
  set(n: string, v: string) {
    this.data.set(n, v);
  }
  delete(n: string) {
    this.data.delete(n);
  }
}

describe("auth", () => {
  it("dev login stores a token, renews it before expiry, and signs out", async () => {
    let now = 1000;
    let issued = 0;
    const backend = {
      devSession: async (): Promise<SessionOut> => ({ token: `t${++issued}`, expires_at: now + 3600, user_id: "u", email: "dev@localhost" }),
      health: async () => ({ status: "ok", dev_login: true }),
    } as unknown as BackendClient;
    const secrets = new MemorySecrets();
    const auth = new AuthManager(backend, () => DEFAULT_SETTINGS, secrets, () => now);
    expect(auth.state.signedIn).toBe(false);
    expect(await auth.token()).toBeNull();
    expect(await auth.devAvailable()).toBe(true);
    const changes: boolean[] = [];
    auth.on("change", (s) => changes.push(s.signedIn));
    expect(await auth.devSignIn()).toEqual({ signedIn: true, email: "dev@localhost", kind: "dev" });
    expect(await auth.token()).toBe("t1");
    // A new AuthManager (app restart) picks the session up from the keychain.
    expect(new AuthManager(backend, () => DEFAULT_SETTINGS, secrets, () => now).state.signedIn).toBe(true);
    now += 3600 - 60; // inside the refresh margin
    expect(await auth.token()).toBe("t2");
    await auth.signOut();
    expect(auth.state.signedIn).toBe(false);
    expect(secrets.data.size).toBe(0);
    expect(changes).toEqual([true, true, false]);
  });

  it("asks for Supabase settings before sending a code", async () => {
    const auth = new AuthManager({} as BackendClient, () => DEFAULT_SETTINGS, new MemorySecrets());
    await expect(auth.sendCode("a@b.c")).rejects.toThrow(/anon key/);
  });
});

describe("backend client", () => {
  it("adds the token, reports errors with status, and handles 204", async () => {
    const calls: [string, RequestInit][] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/end")) return new Response(null, { status: 204 });
      if (url.endsWith("/meetings")) return new Response(JSON.stringify({ detail: "Invalid token" }), { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new BackendClient(() => "http://api", async () => "tok", fakeFetch);
    await client.endMeeting("m 1");
    expect(calls[0][0]).toBe("http://api/meetings/m%201/end");
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
    await expect(client.listMeetings()).rejects.toMatchObject({ status: 401, message: expect.stringContaining("Invalid token") });
    const signedOut = new BackendClient(() => "http://api", async () => null, fakeFetch);
    await expect(signedOut.listMeetings()).rejects.toBeInstanceOf(BackendError);
  });
});

describe("live connection", () => {
  let wss: WebSocketServer;
  let url: string;
  const connections: { query: URLSearchParams; frames: number[]; socket: ServerSocket }[] = [];

  beforeEach(async () => {
    connections.length = 0;
    wss = new WebSocketServer({ port: 0 });
    await new Promise((r) => wss.once("listening", r));
    url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws/meetings/m1`;
    wss.on("connection", (socket, req) => {
      const conn = { query: new URL(req.url!, "http://x").searchParams, frames: [] as number[], socket };
      connections.push(conn);
      socket.on("message", (data, isBinary) => {
        if (isBinary) conn.frames.push((data as Buffer)[1]);
      });
      const last = Number(conn.query.get("last_seq"));
      const send = (seq: number, e: object) => socket.send(JSON.stringify({ seq, meeting_id: "m1", ts_ms: 0, ...e }));
      if (last === 0) {
        send(1, { type: "meeting.started", mode: "cloud", providers: {} });
        send(2, { type: "transcript.final", segment_id: "seg_1", channel: "mic", speaker_id: "me", text: "hi", start_ms: 0, end_ms: 1 });
      } else {
        send(3, { type: "transcript.final", segment_id: "seg_2", channel: "mic", speaker_id: "me", text: "again", start_ms: 2, end_ms: 3 });
      }
    });
  });
  afterEach(async () => {
    await new Promise((r) => wss.close(r));
  });

  const until = async (cond: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  function setup(overrides: Partial<Record<string, unknown>> = {}) {
    let tokens = 0;
    const calls: string[] = [];
    const socket = (): MeetingSocket => ({ meeting_id: "m1", ws_url: url, ws_token: `tok${++tokens}` });
    const backend = {
      createMeeting: async () => (calls.push("create"), socket()),
      wsToken: async () => (calls.push("ws-token"), socket()),
      endMeeting: async () => void calls.push("end"),
      ...overrides,
    } as unknown as BackendClient;
    const outbound = new OutboundAudio();
    const live = new LiveConnection({ backend, outbound, backoffMs: [20] });
    const states: LiveState["status"][] = [];
    const events: number[] = [];
    live.on("state", (s) => states.push(s.status));
    live.on("event", (e) => events.push(e.seq));
    return { live, outbound, calls, states, events };
  }

  it("streams audio, survives a dropped socket, and replays buffered audio and missed events", async () => {
    const { live, outbound, calls, states, events } = setup();
    await live.start(defaultStartOptions());
    await until(() => states.includes("live") && events.length === 2);
    expect(connections[0].query.get("token")).toBe("tok1");
    outbound.push(Uint8Array.of(0, 1));
    outbound.push(Uint8Array.of(0, 2));
    await until(() => connections[0].frames.length === 2);

    connections[0].socket.terminate(); // network drop
    await until(() => states.includes("reconnecting"));
    outbound.push(Uint8Array.of(0, 3)); // captured while offline: buffered
    outbound.push(Uint8Array.of(0, 4));
    await until(() => connections.length === 2 && connections[1].frames.length === 2);

    expect(connections[1].query.get("token")).toBe("tok2"); // fresh short-lived token
    expect(connections[1].query.get("last_seq")).toBe("2"); // server replays from here
    expect(connections[1].frames).toEqual([3, 4]); // nothing lost, in order
    await until(() => events.length === 3);
    expect(events).toEqual([1, 2, 3]);
    expect(calls).toEqual(["create", "ws-token"]);

    expect(await live.stop()).toBe("m1");
    expect(calls.at(-1)).toBe("end");
    expect(states.at(-1)).toBe("off");
  });

  it("keeps retrying meeting creation while the backend is down", async () => {
    let fail = 2;
    const { live, states } = setup({
      createMeeting: async () => {
        if (fail-- > 0) throw new BackendError("Backend unreachable", 0);
        return { meeting_id: "m1", ws_url: url, ws_token: "t" };
      },
    });
    await live.start(defaultStartOptions());
    await until(() => states.includes("live"));
    expect(states.filter((s) => s === "connecting").length).toBeGreaterThanOrEqual(3);
    await live.stop();
  });

  it("falls back to local-only when signed out or when the server ends the meeting", async () => {
    const signedOut = setup({ createMeeting: async () => { throw new BackendError("Not signed in", 401); } });
    await signedOut.live.start(defaultStartOptions());
    expect(signedOut.live.state.status).toBe("local-only");

    const { live, states } = setup();
    await live.start(defaultStartOptions());
    await until(() => connections.length === 1 && states.includes("live"));
    connections[0].socket.close(4409, "meeting has ended");
    await until(() => states.at(-1) === "local-only");
    await new Promise((r) => setTimeout(r, 60));
    expect(connections).toHaveLength(1); // no reconnect attempts
  });
});
