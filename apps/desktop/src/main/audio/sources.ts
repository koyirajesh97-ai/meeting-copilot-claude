// Where each channel's audio comes from. Everything is behind one small interface so OS
// specifics stay isolated (PRD risk: OS audio permission changes).

import { createRequire } from "node:module";
import { downmix, pcm16BytesToFloat } from "./resample";

export type OnAudio = (mono: Float32Array, sampleRate: number) => void;

export interface AudioSource {
  readonly name: string;
  start(onAudio: OnAudio): Promise<void>;
  stop(): Promise<void>;
}

// ---------- native loopback (Windows WASAPI; Linux PipeWire) ----------

interface NativeLoopback {
  start(pid: number, cb: (chunk: Buffer) => void): void;
  startSystemAudio(cb: (chunk: Buffer) => void, excludePid?: number): void;
  stop(): void;
}

const nodeRequire = createRequire(import.meta.url);

/** Loads the optional native addon; null if it isn't installed or can't load on this OS. */
export function loadNativeLoopback(): { LoopbackCapture: new () => NativeLoopback } | null {
  try {
    const mod = nodeRequire("loopback-capture");
    return mod.default ?? mod;
  } catch (err) {
    console.warn("[audio] native loopback unavailable:", (err as Error).message);
    return null;
  }
}

/**
 * System audio from the native addon: 48 kHz stereo PCM16. With `processId`, only that app
 * and its child processes are captured (Windows build 20348+), e.g. only Teams. Otherwise
 * all system output except this app itself, so the copilot's own sounds never feed back.
 */
export class NativeLoopbackSource implements AudioSource {
  readonly name: string;
  private capture: NativeLoopback | null = null;

  constructor(
    private readonly addon: { LoopbackCapture: new () => NativeLoopback },
    private readonly processId: number | null,
    private readonly selfPid = process.pid,
  ) {
    this.name = processId ? `native-process:${processId}` : "native-system";
  }

  async start(onAudio: OnAudio): Promise<void> {
    const capture = new this.addon.LoopbackCapture();
    const cb = (chunk: Buffer) => onAudio(downmix(pcm16BytesToFloat(chunk), 2), 48_000);
    if (this.processId) capture.start(this.processId, cb);
    else capture.startSystemAudio(cb, this.selfPid);
    this.capture = capture;
  }

  async stop(): Promise<void> {
    this.capture?.stop();
    this.capture = null;
  }
}

// ---------- process lookup for "capture only this app" (Windows) ----------

/** Parse `tasklist /FO CSV /NH` output into PIDs for an image name (case-insensitive). */
export function parseTasklist(csv: string, imageName: string): number[] {
  const want = imageName.toLowerCase();
  const pids: number[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const cols = line.match(/"([^"]*)"/g)?.map((c) => c.slice(1, -1));
    if (!cols || cols.length < 2) continue;
    if (cols[0].toLowerCase() === want) {
      const pid = Number(cols[1]);
      if (Number.isInteger(pid) && pid > 0) pids.push(pid);
    }
  }
  return pids.sort((a, b) => a - b);
}

export async function findProcessId(imageName: string): Promise<number | null> {
  if (process.platform !== "win32") return null;
  const { execFile } = await import("node:child_process");
  const out = await new Promise<string>((resolve, reject) =>
    execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    ),
  );
  // Lowest PID is usually the app's root process; process capture includes its children.
  return parseTasklist(out, imageName)[0] ?? null;
}
