import { readdirSync } from "node:fs";
import { AudioChannel, decodeFrame, FRAME_SAMPLES, WIRE_FRAME_BYTES } from "@meeting-copilot/shared";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioCapture, repairRecordings } from "./capture";
import { Framer } from "./framer";
import { LevelMeter } from "./levels";
import { OutboundAudio, REPLAY_CAPACITY } from "@meeting-copilot/shared";
import { ChannelPipeline } from "./pipeline";
import { downmix, floatToPcm16, pcm16BytesToFloat, Resampler } from "./resample";
import { RingBuffer } from "@meeting-copilot/shared";
import { SileroDetector } from "./silero";
import { SilenceWatch } from "./silence";
import { parseTasklist, type AudioSource, type OnAudio } from "./sources";
import { EnergyDetector, rmsDbfs, VadGate, type VoiceDetector } from "./vad";
import { repairWav, WavWriter } from "./wav";

const FIXTURE = resolve(import.meta.dirname, "../../../../../evals/fixtures/audio/speech-22k.wav");

function sine(freq: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
}

function rms(x: Float32Array): number {
  return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
}

function zeroCrossings(x: Float32Array): number {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) n++;
  return n;
}

function readWav(path: string): { rate: number; dataBytes: number; samples: Int16Array } {
  const b = readFileSync(path);
  const dataBytes = b.readUInt32LE(40);
  const pcm = b.subarray(44, 44 + dataBytes);
  return { rate: b.readUInt32LE(24), dataBytes, samples: new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)) };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "copilot-audio-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("resampling", () => {
  it.each([48_000, 44_100, 22_050, 16_000])("keeps a 1 kHz tone at 1 kHz from %d Hz", (rate) => {
    const r = new Resampler(rate);
    const input = sine(1000, rate, 1);
    // Feed in uneven chunks to prove the stream state carries across chunk boundaries.
    const out: number[] = [];
    for (let i = 0; i < input.length; i += 997) out.push(...r.process(input.subarray(i, i + 997)));
    const y = Float32Array.from(out);
    expect(Math.abs(y.length - 16_000)).toBeLessThan(40);
    const body = y.subarray(400, 15_400); // skip filter warm-up
    expect(zeroCrossings(body) / (body.length / 16_000)).toBeCloseTo(2000, -1);
    expect(rms(body)).toBeGreaterThan(0.3);
  });

  it("removes content above 8 kHz instead of aliasing it", () => {
    const r = new Resampler(48_000);
    const y = r.process(sine(12_000, 48_000, 0.5));
    expect(rms(y.subarray(200))).toBeLessThan(0.02);
  });

  it("downmixes stereo and converts PCM16 both ways with clipping", () => {
    expect(Array.from(downmix(Float32Array.from([1, 0, 0.5, 0.5]), 2))).toEqual([0.5, 0.5]);
    expect(Array.from(floatToPcm16(Float32Array.from([0, 1, -1, 2, -2])))).toEqual([0, 32767, -32768, 32767, -32768]);
    const bytes = new Uint8Array(new Int16Array([16384, -16384]).buffer);
    expect(Array.from(pcm16BytesToFloat(bytes))).toEqual([0.5, -0.5]);
  });
});

describe("framing", () => {
  it("emits exact 320-sample frames and pads the tail on flush", () => {
    const f = new Framer();
    const frames = [...f.push(new Int16Array(500).fill(1)), ...f.push(new Int16Array(500).fill(2))];
    expect(frames).toHaveLength(3);
    expect(frames.every((x) => x.length === FRAME_SAMPLES)).toBe(true);
    expect(frames[1][179]).toBe(1);
    expect(frames[1][180]).toBe(2);
    const tail = f.flush();
    expect(tail).toHaveLength(1);
    expect(tail[0][39]).toBe(2);
    expect(tail[0][40]).toBe(0);
    expect(f.flush()).toHaveLength(0);
  });
});

describe("ring buffer and replay", () => {
  it("drops the oldest items when full", () => {
    const r = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => r.push(n));
    expect(r.dropped).toBe(2);
    expect(r.drain()).toEqual([3, 4, 5]);
    expect(r.size).toBe(0);
  });

  it("holds 60 s of both channels", () => {
    expect(REPLAY_CAPACITY).toBe(6000);
  });

  it("buffers while detached and replays in order on reconnect", () => {
    const out = new OutboundAudio(4);
    const sent: number[] = [];
    [1, 2, 3, 4, 5].forEach((n) => out.push(Uint8Array.of(n)));
    expect(out.buffered).toBe(4);
    expect(out.dropped).toBe(1);
    expect(out.attach((f) => (sent.push(f[0]), true))).toBe(4);
    out.push(Uint8Array.of(6));
    expect(sent).toEqual([2, 3, 4, 5, 6]);
  });

  it("re-buffers when the transport fails mid-replay", () => {
    const out = new OutboundAudio(10);
    [1, 2, 3].forEach((n) => out.push(Uint8Array.of(n)));
    let ok = 1;
    expect(out.attach(() => ok-- > 0)).toBe(1);
    expect(out.attached).toBe(false);
    expect(out.buffered).toBe(2);
    out.push(Uint8Array.of(4));
    const sent: number[] = [];
    out.attach((f) => (sent.push(f[0]), true));
    expect(sent).toEqual([2, 3, 4]);
  });
});

class ScriptedDetector implements VoiceDetector {
  constructor(private readonly probs: number[]) {}
  i = 0;
  async probability(): Promise<number> {
    return this.probs[this.i++] ?? 0;
  }
}

describe("VAD gating", () => {
  const frame = (n: number) => new Int16Array(FRAME_SAMPLES).fill(n);

  it("sends nothing during silence", async () => {
    const gate = new VadGate(new ScriptedDetector(new Array(50).fill(0.1)));
    for (let i = 0; i < 50; i++) expect(await gate.push(frame(i))).toEqual([]);
  });

  it("adds 300 ms of padding before and after speech", async () => {
    // 20 quiet, 10 speech, 30 quiet frames (20 ms each).
    const probs = [...new Array(20).fill(0.1), ...new Array(10).fill(0.9), ...new Array(30).fill(0.1)];
    const gate = new VadGate(new ScriptedDetector(probs));
    const sent: number[] = [];
    for (let i = 0; i < probs.length; i++) for (const f of await gate.push(frame(i))) sent.push(f[0]);
    // Pre-roll: frames 5..19 (15 frames = 300 ms), speech 20..29, hangover 30..44 (300 ms).
    expect(sent[0]).toBe(5);
    expect(sent).toEqual(Array.from({ length: 40 }, (_, i) => i + 5));
    expect(gate.isSpeaking).toBe(false);
  });

  it("keeps order when the detector is slow", async () => {
    let n = 0;
    const slow: VoiceDetector = { probability: () => new Promise((r) => setTimeout(() => r(n++ < 2 ? 0.9 : 0.9), 5 - n)) };
    const gate = new VadGate(slow);
    const results = await Promise.all([0, 1, 2, 3].map((i) => gate.push(frame(i))));
    expect(results.flat().map((f) => f[0])).toEqual([0, 1, 2, 3]);
  });

  it("energy fallback scores loud above quiet", () => {
    const e = new EnergyDetector();
    expect(e.probability(sine(300, 16_000, 0.02, 0.3))).toBe(1);
    expect(e.probability(sine(300, 16_000, 0.02, 0.0005))).toBe(0);
    expect(rmsDbfs(new Int16Array(10))).toBe(-Infinity);
  });
});

describe("Silero VAD on real speech", () => {
  it("finds the sentence in the fixture and not the padding", async () => {
    const wav = readWav(FIXTURE);
    const float = Float32Array.from(wav.samples, (s) => s / 32768);
    const pcm = floatToPcm16(new Resampler(wav.rate).process(float));
    const frames = new Framer().push(pcm);
    const det = await SileroDetector.create();
    const probs: number[] = [];
    for (const f of frames) probs.push(await det.probability(Float32Array.from(f, (s) => s / 32768)));

    const lead = probs.slice(0, 40); // first 0.8 s is silence
    const speech = probs.slice(75, 250); // well inside the sentence
    expect(Math.max(...lead)).toBeLessThan(0.3);
    expect(speech.filter((p) => p > 0.5).length / speech.length).toBeGreaterThan(0.5);

    const gate = new VadGate({ probability: (() => { let i = 0; return () => probs[i++]; })() });
    let sent = 0;
    for (const f of frames) sent += (await gate.push(f)).length;
    expect(sent).toBeGreaterThan(150); // most of the ~4.5 s sentence
    expect(sent).toBeLessThan(frames.length - 60); // most of the 2 s of silence is dropped
  }, 30_000);
});

describe("WAV files", () => {
  it("writes a valid 16 kHz mono PCM16 file", () => {
    const path = join(dir, "a.wav");
    const w = new WavWriter(path);
    for (let i = 0; i < 100; i++) w.write(new Int16Array(FRAME_SAMPLES).fill(i));
    w.close();
    const r = readWav(path);
    expect(r.rate).toBe(16_000);
    expect(r.dataBytes).toBe(100 * 640);
    expect(r.samples[320 * 42]).toBe(42);
    expect(statSync(path).size).toBe(44 + 100 * 640);
  });

  it("keeps the header current while recording (crash-safe)", () => {
    const path = join(dir, "b.wav");
    const w = new WavWriter(path, 0); // sync on every write
    w.write(new Int16Array(FRAME_SAMPLES));
    w.write(new Int16Array(FRAME_SAMPLES));
    // Simulate a crash: read without close().
    expect(readWav(path).dataBytes).toBe(1280);
  });

  it("repairs a header left stale by a crash", () => {
    const path = join(dir, "c.wav");
    const w = new WavWriter(path, 60_000);
    w.write(new Int16Array(FRAME_SAMPLES));
    w.flush();
    // Append bytes behind the writer's back, as if the last header update never happened.
    writeFileSync(path, Buffer.alloc(641), { flag: "a" });
    expect(repairWav(path)).toBe(true);
    expect(readWav(path).dataBytes).toBe(640 + 640);
    expect(repairWav(path)).toBe(false);
  });
});

describe("meters and silence", () => {
  it("level rises with loudness and decays", () => {
    const m = new LevelMeter();
    m.push(floatToPcm16(sine(440, 16_000, 0.02, 0.5)));
    const loud = m.read();
    expect(loud).toBeGreaterThan(0.8);
    for (let i = 0; i < 20; i++) m.push(new Int16Array(FRAME_SAMPLES));
    expect(m.read()).toBeLessThan(0.1);
  });

  it("fires once after a long digital silence and resets on sound", () => {
    const w = new SilenceWatch(100);
    const zero = new Int16Array(FRAME_SAMPLES);
    const results = Array.from({ length: 6 }, () => w.push(zero));
    expect(results).toEqual([false, false, false, false, true, false]);
    w.push(new Int16Array(FRAME_SAMPLES).fill(3));
    expect(Array.from({ length: 5 }, () => w.push(zero)).at(-1)).toBe(true);
  });
});

describe("channel pipeline", () => {
  it("writes everything to WAV and sends wire frames tagged with the channel", async () => {
    const out = new OutboundAudio();
    const sent: Uint8Array[] = [];
    out.attach((f) => (sent.push(f), true));
    const p = new ChannelPipeline({ channel: AudioChannel.System, wavPath: join(dir, "system.wav"), outbound: out });
    const tone = sine(440, 48_000, 1);
    for (let i = 0; i < tone.length; i += 960) p.push(tone.subarray(i, i + 960), 48_000);
    await p.stop();
    expect(p.framesCaptured).toBeGreaterThanOrEqual(49);
    expect(sent.length).toBe(p.framesCaptured);
    expect(sent.every((f) => f.length === WIRE_FRAME_BYTES && decodeFrame(f).channel === AudioChannel.System)).toBe(true);
    expect(readWav(join(dir, "system.wav")).dataBytes).toBe(p.framesCaptured * 640);
  });

  it("Live-only writes no WAV; while paused nothing is written or sent", async () => {
    const out = new OutboundAudio();
    const sent: Uint8Array[] = [];
    out.attach((f) => (sent.push(f), true));
    const p = new ChannelPipeline({ channel: AudioChannel.System, wavPath: null, outbound: out });
    p.push(sine(440, 16_000, 0.2), 16_000);
    p.paused = true;
    p.push(sine(440, 16_000, 1), 16_000);
    p.paused = false;
    p.push(sine(440, 16_000, 0.2), 16_000);
    await p.stop();
    expect(p.framesCaptured).toBe(20);
    expect(sent.length).toBe(20);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("mic: records all audio locally but sends only speech", async () => {
    const out = new OutboundAudio();
    const vad = new VadGate(new EnergyDetector());
    const p = new ChannelPipeline({ channel: AudioChannel.Mic, wavPath: join(dir, "mic.wav"), outbound: out, vad });
    p.push(new Float32Array(16_000), 16_000); // 1 s silence
    p.push(sine(300, 16_000, 0.5, 0.3), 16_000); // 0.5 s "speech"
    p.push(new Float32Array(16_000), 16_000); // 1 s silence
    await p.stop();
    expect(p.framesCaptured).toBe(125);
    // 25 loud frames + 15 pre-roll + ~15 hangover
    expect(p.framesSent).toBeGreaterThanOrEqual(50);
    expect(p.framesSent).toBeLessThanOrEqual(60);
    expect(out.buffered).toBe(p.framesSent); // no transport attached: buffered for replay
  });
});

class FakeSource implements AudioSource {
  started = false;
  private timer: NodeJS.Timeout | null = null;
  constructor(readonly name: string, private readonly amp: number, private readonly fail = false) {}
  async start(onAudio: OnAudio): Promise<void> {
    if (this.fail) throw new Error("Permission denied");
    this.started = true;
    const chunk = sine(440, 48_000, 0.02, this.amp);
    this.timer = setInterval(() => onAudio(chunk, 48_000), 2);
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.started = false;
  }
}

describe("AudioCapture", () => {
  it("records two channels to separate WAVs and reports live status and levels", async () => {
    const mic = new FakeSource("fake-mic", 0.3);
    const sys = new FakeSource("fake-system", 0.3);
    const cap = new AudioCapture({
      recordingsDir: dir,
      micSource: () => mic,
      systemSource: async () => sys,
      createDetector: async () => new EnergyDetector(),
      levelIntervalMs: 5,
    });
    const levels: number[] = [];
    cap.on("levels", (l) => levels.push(l.mic, l.system));
    const status = await cap.start({ micDeviceId: null, systemApp: null, sessionId: "s1" });
    expect(status.mic.state).toBe("live");
    expect(status.system).toEqual({ state: "live", source: "fake-system" });
    await new Promise((r) => setTimeout(r, 150));
    const summary = await cap.stop();
    expect(summary!.dir).toBe(join(dir, "s1"));
    expect(summary!.mic.framesCaptured).toBeGreaterThan(10);
    expect(summary!.system.framesCaptured).toBeGreaterThan(10);
    expect(readWav(join(dir, "s1", "mic.wav")).dataBytes).toBe(summary!.mic.framesCaptured * 640);
    expect(readWav(join(dir, "s1", "system.wav")).dataBytes).toBe(summary!.system.framesCaptured * 640);
    expect(Math.max(...levels)).toBeGreaterThan(0.5);
    expect(cap.currentStatus.mic.state).toBe("off");
  });

  it("keeps recording the mic when system audio is unavailable or fails", async () => {
    for (const systemSource of [async () => null, async () => new FakeSource("sys", 0.3, true)]) {
      const cap = new AudioCapture({
        recordingsDir: dir,
        micSource: () => new FakeSource("mic", 0.3),
        systemSource,
        createDetector: async () => {
          throw new Error("no model");
        },
      });
      const status = await cap.start({ micDeviceId: null, systemApp: null });
      expect(status.mic.state).toBe("live");
      expect(status.mic.source).toContain("vad: energy");
      expect(["unavailable", "error"]).toContain(status.system.state);
      await cap.stop();
    }
  });

  it("flags a digitally silent system channel", async () => {
    const cap = new AudioCapture({
      recordingsDir: dir,
      micSource: () => new FakeSource("mic", 0.3),
      systemSource: async () => new FakeSource("sys", 0),
      createDetector: async () => new EnergyDetector(),
      silenceAfterMs: 100,
    });
    await cap.start({ micDeviceId: null, systemApp: null });
    await new Promise((r) => setTimeout(r, 120));
    expect(cap.currentStatus.system.state).toBe("silent");
    await cap.stop();
  });

  it("repairs crashed recordings found at startup", () => {
    const session = join(dir, "s2");
    mkdirSync(session);
    const path = join(session, "mic.wav");
    const w = new WavWriter(path, 60_000);
    w.flush();
    writeFileSync(path, Buffer.alloc(640), { flag: "a" }); // audio written after the last header update
    expect(repairRecordings(dir)).toEqual([path]);
    expect(repairRecordings(join(dir, "missing"))).toEqual([]);
  });
});

describe("Windows process lookup", () => {
  it("parses tasklist CSV output", () => {
    const csv = [
      '"System Idle Process","0","Services","0","8 K"',
      '"ms-teams.exe","15400","Console","1","250,000 K"',
      '"ms-teams.exe","9100","Console","1","90,000 K"',
      '"Zoom.exe","777","Console","1","1 K"',
    ].join("\r\n");
    expect(parseTasklist(csv, "MS-Teams.exe")).toEqual([9100, 15400]);
    expect(parseTasklist(csv, "slack.exe")).toEqual([]);
  });
});
