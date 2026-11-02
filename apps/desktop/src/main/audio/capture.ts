// AudioCapture: the one interface the rest of the app uses. Starts a mic source and a system
// source, runs each through its ChannelPipeline, writes <recordings>/<id>/{mic,system}.wav,
// and reports channel status and level meters. OS-specific sources are injected.

import { AudioChannel } from "@meeting-copilot/shared";
import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AudioLevels, ChannelState, ChannelStatus } from "../../shared/ipc";
import { OutboundAudio } from "./outbound";
import { ChannelPipeline } from "./pipeline";
import type { AudioSource } from "./sources";
import { EnergyDetector, VadGate, type VoiceDetector } from "./vad";
import { repairWav } from "./wav";

export interface CaptureDeps {
  recordingsDir: string;
  micSource: (deviceId: string | null) => AudioSource;
  /** Returns null when this OS/setup has no way to capture system audio. */
  systemSource: (appImageName: string | null) => Promise<AudioSource | null>;
  createDetector: () => Promise<VoiceDetector>;
  outbound?: OutboundAudio;
  levelIntervalMs?: number;
  silenceAfterMs?: number;
}

export interface CaptureStartOptions {
  micDeviceId: string | null;
  /** Windows: capture only this app's audio, e.g. "ms-teams.exe". */
  systemApp: string | null;
  /** Folder name under recordingsDir; defaults to a timestamp. */
  sessionId?: string;
  /** False in Live-only mode: no WAV files (audio is only streamed for live help). */
  keepAudio?: boolean;
}

export interface CaptureSummary {
  dir: string | null;
  mic: { framesCaptured: number; framesSent: number };
  system: { framesCaptured: number; framesSent: number };
}

interface Running {
  /** Null when nothing is kept on disk (Live-only). */
  dir: string | null;
  pipelines: Partial<Record<"mic" | "system", ChannelPipeline>>;
  sources: Partial<Record<"mic" | "system", AudioSource>>;
  timer: NodeJS.Timeout;
}

export const OFF: ChannelState = { state: "off" };

export class AudioCapture extends EventEmitter<{ status: [ChannelStatus]; levels: [AudioLevels] }> {
  readonly outbound: OutboundAudio;
  private running: Running | null = null;
  private status: ChannelStatus = { mic: OFF, system: OFF };

  constructor(private readonly deps: CaptureDeps) {
    super();
    this.outbound = deps.outbound ?? new OutboundAudio();
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  get currentStatus(): ChannelStatus {
    return this.status;
  }

  private setChannel(channel: "mic" | "system", next: ChannelState): void {
    this.status = { ...this.status, [channel]: next };
    this.emit("status", this.status);
  }

  async start(opts: CaptureStartOptions): Promise<ChannelStatus> {
    if (this.running) return this.status;
    const id = opts.sessionId ?? new Date().toISOString().replace(/[:.]/g, "-");
    const dir = opts.keepAudio === false ? null : join(this.deps.recordingsDir, id);
    if (dir) mkdirSync(dir, { recursive: true });

    const running: Running = { dir, pipelines: {}, sources: {}, timer: setInterval(() => this.emitLevels(), this.deps.levelIntervalMs ?? 100) };
    this.running = running;
    this.setChannel("mic", { state: "starting" });
    this.setChannel("system", { state: "starting" });

    await Promise.all([this.startMic(running, opts), this.startSystem(running, opts)]);
    return this.status;
  }

  private async startMic(running: Running, opts: CaptureStartOptions): Promise<void> {
    let detector: VoiceDetector;
    let vadName = "silero";
    try {
      detector = await this.deps.createDetector();
    } catch (err) {
      console.warn("[audio] Silero VAD failed to load; using the energy detector", err);
      detector = new EnergyDetector();
      vadName = "energy";
    }
    const pipeline = new ChannelPipeline({
      channel: AudioChannel.Mic,
      wavPath: running.dir && join(running.dir, "mic.wav"),
      outbound: this.outbound,
      vad: new VadGate(detector),
    });
    const source = this.deps.micSource(opts.micDeviceId);
    try {
      await source.start((samples, rate) => pipeline.push(samples, rate));
      running.pipelines.mic = pipeline;
      running.sources.mic = source;
      this.setChannel("mic", { state: "live", source: `${source.name} (vad: ${vadName})` });
    } catch (err) {
      await pipeline.stop();
      this.setChannel("mic", { state: "error", message: (err as Error).message });
    }
  }

  private async startSystem(running: Running, opts: CaptureStartOptions): Promise<void> {
    let source: AudioSource | null = null;
    try {
      source = await this.deps.systemSource(opts.systemApp);
    } catch (err) {
      this.setChannel("system", { state: "error", message: (err as Error).message });
      return;
    }
    if (!source) {
      this.setChannel("system", { state: "unavailable", message: "System audio capture isn't supported on this computer yet." });
      return;
    }
    const pipeline = new ChannelPipeline({
      channel: AudioChannel.System,
      wavPath: running.dir && join(running.dir, "system.wav"),
      outbound: this.outbound,
      silenceAfterMs: this.deps.silenceAfterMs,
      onSilent: () =>
        this.setChannel("system", {
          state: "silent",
          source: source.name,
          message: "No meeting audio heard yet. If the meeting is playing, check system-audio permission.",
        }),
    });
    try {
      await source.start((samples, rate) => {
        pipeline.push(samples, rate);
        if (this.status.system.state === "silent" && pipeline.level > 0) {
          this.setChannel("system", { state: "live", source: source.name });
        }
      });
      running.pipelines.system = pipeline;
      running.sources.system = source;
      this.setChannel("system", { state: "live", source: source.name });
    } catch (err) {
      await pipeline.stop();
      this.setChannel("system", { state: "error", message: (err as Error).message });
    }
  }

  private emitLevels(): void {
    const r = this.running;
    if (!r) return;
    this.emit("levels", { mic: r.pipelines.mic?.level ?? 0, system: r.pipelines.system?.level ?? 0 });
  }

  /** The folder this recording's WAV files go to (null when not recording or Live-only). */
  get currentDir(): string | null {
    return this.running?.dir ?? null;
  }

  /** Pause drops audio (nothing written or sent) until resumed; the session stays open. */
  setPaused(paused: boolean): void {
    for (const p of Object.values(this.running?.pipelines ?? {})) p.paused = paused;
    if (paused) this.emit("levels", { mic: 0, system: 0 });
  }

  async stop(): Promise<CaptureSummary | null> {
    const r = this.running;
    if (!r) return null;
    this.running = null;
    clearInterval(r.timer);
    await Promise.all(Object.values(r.sources).map((s) => s.stop().catch(() => undefined)));
    await Promise.all(Object.values(r.pipelines).map((p) => p.stop()));
    const stats = (p?: ChannelPipeline) => ({ framesCaptured: p?.framesCaptured ?? 0, framesSent: p?.framesSent ?? 0 });
    this.status = { mic: OFF, system: OFF };
    this.emit("status", this.status);
    this.emit("levels", { mic: 0, system: 0 });
    return { dir: r.dir, mic: stats(r.pipelines.mic), system: stats(r.pipelines.system) };
  }
}

/** Fix WAV headers left behind by a crash. Returns the files that were repaired. */
export function repairRecordings(recordingsDir: string): string[] {
  const fixed: string[] = [];
  let sessions: string[];
  try {
    sessions = readdirSync(recordingsDir);
  } catch {
    return fixed;
  }
  for (const s of sessions) {
    const dir = join(recordingsDir, s);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".wav") && repairWav(join(dir, f))) fixed.push(join(dir, f));
    }
  }
  return fixed;
}
