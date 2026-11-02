// Streaming resampler to 16 kHz mono: windowed-sinc low-pass FIR, then fractional
// linear interpolation. Keeps state between chunks so chunk boundaries are seamless.

import { SAMPLE_RATE } from "@meeting-copilot/shared";

const TAPS = 63;

function lowPassKernel(cutoff: number): Float32Array {
  // cutoff as a fraction of the input sample rate (0..0.5). Blackman window.
  const k = new Float32Array(TAPS);
  const m = TAPS - 1;
  let sum = 0;
  for (let i = 0; i < TAPS; i++) {
    const x = i - m / 2;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / m) + 0.08 * Math.cos((4 * Math.PI * i) / m);
    k[i] = sinc * w;
    sum += k[i];
  }
  for (let i = 0; i < TAPS; i++) k[i] /= sum;
  return k;
}

export class Resampler {
  private readonly step: number;
  private readonly kernel: Float32Array | null;
  private readonly history = new Float32Array(TAPS - 1);
  private filtered: number[] = [];
  /** Position of the next output sample, in filtered-input samples. */
  private pos = 0;

  constructor(readonly inputRate: number, readonly outputRate: number = SAMPLE_RATE) {
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error("Sample rates must be positive");
    this.step = inputRate / outputRate;
    // Only filter when downsampling; leave 10% headroom below the new Nyquist.
    this.kernel = inputRate > outputRate ? lowPassKernel((0.45 * outputRate) / inputRate) : null;
  }

  /** Mono float samples in [-1, 1] at inputRate in, mono float samples at outputRate out. */
  process(input: Float32Array): Float32Array {
    const filtered = this.kernel ? this.filter(input) : input;
    for (const v of filtered) this.filtered.push(v);

    const out: number[] = [];
    const buf = this.filtered;
    while (this.pos + 1 < buf.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      out.push(buf[i] + (buf[i + 1] - buf[i]) * frac);
      this.pos += this.step;
    }
    // Drop consumed samples, keep the one we still interpolate from.
    const drop = Math.min(Math.floor(this.pos), buf.length);
    if (drop > 0) {
      this.filtered = buf.slice(drop);
      this.pos -= drop;
    }
    return Float32Array.from(out);
  }

  private filter(input: Float32Array): Float32Array {
    const k = this.kernel!;
    const h = this.history;
    const n = h.length;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let acc = 0;
      for (let t = 0; t < TAPS; t++) {
        const idx = i - t; // input index; negative reaches into history
        const v = idx >= 0 ? input[idx] : h[n + idx];
        acc += k[t] * v;
      }
      out[i] = acc;
    }
    // Keep the last TAPS-1 input samples for the next chunk.
    if (input.length >= n) h.set(input.subarray(input.length - n));
    else {
      h.copyWithin(0, input.length);
      h.set(input, n - input.length);
    }
    return out;
  }
}

/** Average interleaved channels into mono. */
export function downmix(interleaved: Float32Array, channels: number): Float32Array {
  if (channels === 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += interleaved[f * channels + c];
    out[f] = s / channels;
  }
  return out;
}

/** Interleaved PCM16 little-endian bytes (as delivered by native loopback) to float. */
export function pcm16BytesToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}
