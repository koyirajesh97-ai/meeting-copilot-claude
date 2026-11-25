import { FRAME_MS } from "./audio";
import { RingBuffer } from "./ringBuffer";

/** 60 s across both channels (50 frames/s each). */
export const REPLAY_SECONDS = 60;
export const REPLAY_CAPACITY = (REPLAY_SECONDS * 1000 * 2) / FRAME_MS;

/**
 * Where wire frames go. While a transport is attached, frames are sent live. While it's
 * detached (no backend yet, or the network dropped), the last 60 s are buffered and
 * replayed in order on the next attach.
 *
 * A transport that can't take a frame right now (`send` returns false: a slow uplink filled
 * the socket's send buffer) stays attached: frames queue here, oldest first, and go out as soon
 * as it takes them again. Only `detach` (the socket closed) stops sending.
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

  /** Start sending through `send`, backlog first. Returns how many backlog frames went out. */
  attach(send: (frame: Uint8Array) => boolean): number {
    this.send = send;
    return this.flush();
  }

  /** Send queued frames, oldest first, until the transport pushes back. Returns how many went. */
  flush(): number {
    let sent = 0;
    while (this.send && this.buffer.size > 0) {
      if (!this.send(this.buffer.peek()!)) break;
      this.buffer.shift();
      sent++;
    }
    return sent;
  }

  /** Drop everything buffered (audio that must never be sent, like setup's audio check). */
  clear(): void {
    this.buffer.drain();
  }

  detach(): void {
    this.send = null;
  }

  push(frame: Uint8Array): void {
    if (this.send && this.buffer.size === 0 && this.send(frame)) return;
    this.buffer.push(frame);
    this.flush();
  }
}
