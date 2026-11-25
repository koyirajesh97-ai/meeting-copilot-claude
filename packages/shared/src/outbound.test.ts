import { describe, expect, it } from "vitest";
import { OutboundAudio } from "./outbound";

const frame = (n: number) => Uint8Array.of(0, n);

describe("OutboundAudio", () => {
  it("buffers while detached and replays in order on attach", () => {
    const out = new OutboundAudio(10);
    out.push(frame(1));
    out.push(frame(2));
    const sent: number[] = [];
    expect(out.attach((f) => (sent.push(f[1]), true))).toBe(2);
    out.push(frame(3));
    expect(sent).toEqual([1, 2, 3]);
    expect(out.buffered).toBe(0);
  });

  it("keeps sending after the transport pushes back for a while (slow uplink)", () => {
    const out = new OutboundAudio(10);
    const sent: number[] = [];
    let congested = false;
    out.attach((f) => {
      if (congested) return false;
      sent.push(f[1]);
      return true;
    });
    out.push(frame(1));
    congested = true; // the socket's send buffer is full
    out.push(frame(2));
    out.push(frame(3));
    expect(out.attached).toBe(true);
    expect(out.buffered).toBe(2);
    congested = false; // it drained
    out.push(frame(4));
    expect(sent).toEqual([1, 2, 3, 4]); // nothing lost, still in order
    expect(out.buffered).toBe(0);
  });

  it("flushes the backlog without new frames (after capture stops)", () => {
    const out = new OutboundAudio(10);
    let ok = false;
    const sent: number[] = [];
    out.attach((f) => (ok ? (sent.push(f[1]), true) : false));
    out.push(frame(1));
    out.push(frame(2));
    ok = true;
    expect(out.flush()).toBe(2);
    expect(sent).toEqual([1, 2]);
  });

  it("drops the oldest audio once the buffer is full", () => {
    const out = new OutboundAudio(2);
    for (const n of [1, 2, 3]) out.push(frame(n));
    expect(out.dropped).toBe(1);
    const sent: number[] = [];
    out.attach((f) => (sent.push(f[1]), true));
    expect(sent).toEqual([2, 3]);
  });
});
