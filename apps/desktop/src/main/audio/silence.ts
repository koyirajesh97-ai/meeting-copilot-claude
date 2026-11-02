// Detects a system channel that is digitally silent (all zeros) for a long time. That's what
// macOS delivers when system-audio permission is missing, so we can show a help screen.

import { FRAME_MS } from "@meeting-copilot/shared";

export class SilenceWatch {
  private zeroMs = 0;
  private fired = false;

  constructor(private readonly afterMs = 15_000) {}

  /** Returns true once, when the stream has been all zeros for `afterMs`. */
  push(frame: Int16Array): boolean {
    if (frame.some((s) => s !== 0)) {
      this.zeroMs = 0;
      this.fired = false;
      return false;
    }
    this.zeroMs += FRAME_MS;
    if (!this.fired && this.zeroMs >= this.afterMs) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
