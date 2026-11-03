// The phone's core against the real backend (Fake providers): sign in, start a meeting, stream
// the phone mic as one channel, get live captions and a Catch me up card, stop, read the summary.

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Api } from "./api";
import { Auth, type KeyStore } from "./auth";
import { PhoneMeeting, type Recorder } from "./meeting";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const SPEECH = readFileSync(join(ROOT, "evals", "fixtures", "audio", "speech-16k.wav")).subarray(44);

let backend: ChildProcess | null = null;
let url = "";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  backend = spawn("uv", ["run", "-q", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: join(ROOT, "services", "backend"),
    env: {
      ...process.env,
      ALLOW_DEV_LOGIN: "1",
      COPILOT_FAKE_PROVIDERS: "1",
      BACKEND_SECRET: "mobile-test-secret-mobile-test-secret-0123",
      DATABASE_URL: "",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("backend didn't start");
}, 40_000);

afterAll(() => {
  backend?.kill();
});

/** Plays the speech fixture in 100 ms base64 chunks, like the native recorder, in a loop. */
class FileRecorder implements Recorder {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pos = 0;
  async start(onChunk: (data: string) => void): Promise<void> {
    this.timer = setInterval(() => {
      for (let n = 0; n < 4; n++) {
        if (this.pos + 3200 > SPEECH.length) this.pos = 0;
        onChunk(Buffer.from(SPEECH.subarray(this.pos, this.pos + 3200)).toString("base64"));
        this.pos += 3200;
      }
    }, 100); // 4x real time keeps the test short
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }
}

class MemoryStore implements KeyStore {
  m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.m.set(k, v);
  }
  async delete(k: string) {
    this.m.delete(k);
  }
}

const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe("phone companion end to end", () => {
  it("streams the phone mic and gets captions, a card and the summary", async () => {
    const auth = new Auth(new Api(() => url, async () => null), new MemoryStore(), () => ({ url: "", anonKey: "" }));
    const api = new Api(() => url, () => auth.token());
    await auth.devSignIn();
    const meeting = new PhoneMeeting(api, new FileRecorder());
    await meeting.start({ title: "Phone standup", type: "standup", mode: "cloud", visibility: "private", project_id: null });
    expect(meeting.state.recording).toBe(true);

    await until(() => meeting.state.live.status === "live", 15_000);
    await until(() => meeting.state.captions.finals.length >= 2, 30_000);
    const first = meeting.state.captions.finals[0];
    expect(first.channel).toBe("system"); // the room's audio: diarized, not assumed to be you
    expect(first.text).toContain("Morning everyone");

    expect(meeting.control("catch_up")).toBe(true);
    await until(() => meeting.state.cards.cards.some((c) => c.kind === "catch_up"), 15_000);

    const id = await meeting.stop();
    expect(meeting.state.recording).toBe(false);
    expect(id).toBeTruthy();
    let status = "pending";
    for (let i = 0; i < 100 && status !== "ready"; i++) {
      status = (await api.meeting(id!)).summary.status;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(status).toBe("ready");
    const detail = await api.meeting(id!);
    expect(detail.transcript.length).toBeGreaterThanOrEqual(2);
    expect((await api.search("certificate renewal")).some((h) => h.meeting_id === id)).toBe(true);
  }, 90_000);
});
