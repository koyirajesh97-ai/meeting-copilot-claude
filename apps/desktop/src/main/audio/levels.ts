import { rmsDbfs } from "./vad";

/** Turns frames into a 0..1 meter value (-60 dBFS = 0, 0 dBFS = 1) with a peak-hold decay. */
export class LevelMeter {
  private level = 0;

  push(frame: Int16Array): void {
    const db = rmsDbfs(frame);
    const v = Number.isFinite(db) ? Math.min(1, Math.max(0, (db + 60) / 60)) : 0;
    // Rise instantly, fall smoothly so the meter is readable.
    this.level = v > this.level ? v : this.level * 0.85 + v * 0.15;
  }

  read(): number {
    return Math.round(this.level * 100) / 100;
  }
}
