// Silero VAD v5 (MIT) on onnxruntime-web's WebAssembly backend: no native build, runs in the
// Electron main process. The model needs 512-sample windows at 16 kHz, so 20 ms frames
// (320 samples) are buffered and each frame reports the latest window's probability.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { VoiceDetector } from "./vad";

const WINDOW = 512;
const nodeRequire = createRequire(import.meta.url);

type Ort = typeof import("onnxruntime-web");

export function sileroModelPath(): string {
  return nodeRequire.resolve("@ricky0123/vad-web/dist/silero_vad_v5.onnx");
}

export class SileroDetector implements VoiceDetector {
  private pending = new Float32Array(0);
  private last = 0;

  private constructor(
    private readonly ort: Ort,
    private readonly session: import("onnxruntime-web").InferenceSession,
    private state: import("onnxruntime-web").Tensor,
  ) {}

  static async create(modelPath = sileroModelPath()): Promise<SileroDetector> {
    const ort: Ort = nodeRequire("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(readFileSync(modelPath));
    const state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    return new SileroDetector(ort, session, state);
  }

  async probability(frame: Float32Array): Promise<number> {
    const merged = new Float32Array(this.pending.length + frame.length);
    merged.set(this.pending);
    merged.set(frame, this.pending.length);
    let offset = 0;
    while (merged.length - offset >= WINDOW) {
      const input = new this.ort.Tensor("float32", merged.slice(offset, offset + WINDOW), [1, WINDOW]);
      const sr = new this.ort.Tensor("int64", BigInt64Array.from([16000n]), []);
      const out = await this.session.run({ input, state: this.state, sr });
      this.state = out.stateN;
      this.last = (out.output.data as Float32Array)[0];
      offset += WINDOW;
    }
    this.pending = merged.slice(offset);
    return this.last;
  }
}
