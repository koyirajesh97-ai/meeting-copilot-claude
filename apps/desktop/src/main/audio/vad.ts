// Voice-activity gating for the mic channel: mic frames are sent only while the user speaks,
// plus 300 ms of padding before and after so word edges aren't clipped.

import { FRAME_MS } from "@meeting-copilot/shared";

export interface VoiceDetector {
  /** Speech probability (0..1) for one 20 ms frame of 16 kHz float samples. */
  probability(frame: Float32Array): Promise<number> | number;
}

export interface VadOptions {
  /** Probability that starts speech. */
  threshold: number;
  /** Probability below which speech may end (hysteresis). */
  releaseThreshold: number;
  paddingMs: number;
}

export const DEFAULT_VAD: VadOptions = { threshold: 0.5, releaseThreshold: 0.35, paddingMs: 300 };

export class VadGate {
  private readonly padFrames: number;
  private preRoll: Int16Array[] = [];
  private speaking = false;
  private quietFrames = 0;
  /** Serialize async detector calls so frames stay in order. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly detector: VoiceDetector,
    private readonly opts: VadOptions = DEFAULT_VAD,
  ) {
    this.padFrames = Math.round(opts.paddingMs / FRAME_MS);
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Returns the frames to send (possibly none, possibly the pre-roll plus this frame). */
  push(frame: Int16Array): Promise<Int16Array[]> {
    const next = this.chain.then(() => this.step(frame));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async step(frame: Int16Array): Promise<Int16Array[]> {
    const p = await this.detector.probability(toFloat(frame));
    if (!this.speaking) {
      if (p >= this.opts.threshold) {
        this.speaking = true;
        this.quietFrames = 0;
        const out = [...this.preRoll, frame];
        this.preRoll = [];
        return out;
      }
      this.preRoll.push(frame);
      if (this.preRoll.length > this.padFrames) this.preRoll.shift();
      return [];
    }
    // Speaking: keep sending through a 300 ms hangover of quiet frames.
    if (p < this.opts.releaseThreshold) this.quietFrames++;
    else this.quietFrames = 0;
    if (this.quietFrames > this.padFrames) {
      this.speaking = false;
      this.quietFrames = 0;
      this.preRoll = [frame];
      return [];
    }
    return [frame];
  }
}

function toFloat(frame: Int16Array): Float32Array {
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) out[i] = frame[i] / 32768;
  return out;
}

/** Fallback when the Silero model can't load: loudness-based, maps -50..-30 dBFS to 0..1. */
export class EnergyDetector implements VoiceDetector {
  probability(frame: Float32Array): number {
    const db = rmsDbfs(frame);
    return Math.min(1, Math.max(0, (db + 50) / 20));
  }
}

export function rmsDbfs(frame: Float32Array | Int16Array): number {
  const scale = frame instanceof Int16Array ? 1 / 32768 : 1;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] * scale;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, frame.length));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}
