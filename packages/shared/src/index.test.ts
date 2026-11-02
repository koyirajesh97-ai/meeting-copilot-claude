import { describe, expect, it } from "vitest";
import { AudioChannel, decodeFrame, encodeFrame, FRAME_BYTES, FRAME_SAMPLES, WIRE_FRAME_BYTES } from "./index";

describe("audio wire format", () => {
  it("matches the PRD: 20 ms of 16 kHz mono PCM16 is 640 bytes", () => {
    expect(FRAME_SAMPLES).toBe(320);
    expect(FRAME_BYTES).toBe(640);
    expect(WIRE_FRAME_BYTES).toBe(641);
    expect(AudioChannel.Mic).toBe(0);
    expect(AudioChannel.System).toBe(1);
  });

  it("round-trips a frame, little-endian, with the channel in byte 0", () => {
    const pcm = new Int16Array(FRAME_SAMPLES).map((_, i) => (i * 211) % 65536 - 32768);
    const wire = encodeFrame(AudioChannel.System, pcm);
    expect(wire[0]).toBe(1);
    expect(wire[1] | (wire[2] << 8)).toBe(pcm[0] & 0xffff);
    const back = decodeFrame(wire);
    expect(back.channel).toBe(AudioChannel.System);
    expect(Array.from(back.pcm)).toEqual(Array.from(pcm));
  });

  it("rejects wrong sizes and unknown channels", () => {
    expect(() => encodeFrame(AudioChannel.Mic, new Int16Array(10))).toThrow();
    expect(() => decodeFrame(new Uint8Array(100))).toThrow();
    const bad = new Uint8Array(WIRE_FRAME_BYTES);
    bad[0] = 7;
    expect(() => decodeFrame(bad)).toThrow(/channel/);
  });
});
