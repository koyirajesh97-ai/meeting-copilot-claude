import { FRAME_MS } from "./audio";
import { RingBuffer } from "./ringBuffer";

/** 60 s across both channels (50 frames/s each). */
export const REPLAY_SECONDS = 60;
export const REPLAY_CAPACITY = (REPLAY_SECONDS * 1000 * 2) / FRAME_MS;

/**
 * Where wire frames go. While a transport is attached, frames are sent live. While it's
 * detached (no backend yet, or the network dropped), the last 60 s are buffered and
 * replayed in order on the next attach.
 */
export class OutboundAudio {
  private readonly buffer: RingBuffer<Uint8Array>;
  private send: ((frame: Uint8Array) => boolean) | null = null;

  constructor(capacity = REPLAY_CAPACITY) {
    this.buffer = new RingBuffer(capacity);
  }

  get buffered(): number {
    return this.buffer.size;
  }

  get dropped(): number {
    return this.buffer.dropped;
  }

  get attached(): boolean {
    return this.send !== null;
  }

  /** `send` returns false if the transport couldn't take the frame (it is then re-buffered). */
  attach(send: (frame: Uint8Array) => boolean): number {
    this.send = send;
    const backlog = this.buffer.drain();
    for (let i = 0; i < backlog.length; i++) {
      if (!send(backlog[i])) {
        this.detach();
        for (const f of backlog.slice(i)) this.buffer.push(f);
        return i;
      }
    }
    return backlog.length;
  }

  /** Drop everything buffered (audio that must never be sent, like setup's audio check). */
  clear(): void {
    this.buffer.drain();
  }

  detach(): void {
    this.send = null;
  }

  push(frame: Uint8Array): void {
    if (this.send && this.send(frame)) return;
    if (this.send) this.detach();
    this.buffer.push(frame);
  }
}
