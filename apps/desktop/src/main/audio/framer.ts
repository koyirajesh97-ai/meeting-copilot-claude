import { FRAME_SAMPLES } from "@meeting-copilot/shared";

/** Collects PCM16 samples and emits exact 20 ms (320-sample) frames. */
export class Framer {
  private buf = new Int16Array(FRAME_SAMPLES);
  private fill = 0;

  push(samples: Int16Array): Int16Array[] {
    const frames: Int16Array[] = [];
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(FRAME_SAMPLES - this.fill, samples.length - i);
      this.buf.set(samples.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === FRAME_SAMPLES) {
        frames.push(this.buf);
        this.buf = new Int16Array(FRAME_SAMPLES);
        this.fill = 0;
      }
    }
    return frames;
  }

  /** Pad the last partial frame with silence (used when capture stops). */
  flush(): Int16Array[] {
    if (this.fill === 0) return [];
    const last = this.buf;
    this.buf = new Int16Array(FRAME_SAMPLES);
    this.fill = 0;
    return [last];
  }
}
