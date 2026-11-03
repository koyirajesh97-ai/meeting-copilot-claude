import { decodeFrame, FRAME_SAMPLES, WIRE_FRAME_BYTES } from "@meeting-copilot/shared";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToInt16, floatToInt16, level, PHONE_CHANNEL, PhoneFramer } from "./pcm";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("phone audio", () => {
  it("decodes base64 like Buffer does, padding and all", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 641, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
      expect(Array.from(base64ToBytes(b64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("reads little-endian signed PCM16", () => {
    expect(Array.from(bytesToInt16(Uint8Array.from([0x01, 0x00, 0xff, 0xff, 0x00, 0x80, 0xff, 0x7f])))).toEqual([1, -1, -32768, 32767]);
    expect(Array.from(floatToInt16(Float32Array.from([0, 1, -1, 2])))).toEqual([0, 32767, -32768, 32767]);
  });

  it("frames arbitrary chunks into 20 ms wire frames on the system channel", () => {
    const f = new PhoneFramer();
    const samples = Int16Array.from({ length: FRAME_SAMPLES * 3 + 100 }, (_, i) => i - 500);
    const bytes = new Uint8Array(samples.buffer);
    // Odd-sized base64 chunks, as a recorder might deliver them.
    const frames = [...f.pushChunk(b64(bytes.subarray(0, 333))), ...f.pushChunk(b64(bytes.subarray(333, 1001))), ...f.pushChunk(b64(bytes.subarray(1001)))];
    expect(frames).toHaveLength(3);
    expect(frames.every((x) => x.length === WIRE_FRAME_BYTES)).toBe(true);
    const back = frames.flatMap((x) => Array.from(decodeFrame(x).pcm));
    expect(decodeFrame(frames[0]).channel).toBe(PHONE_CHANNEL);
    expect(back).toEqual(Array.from(samples.subarray(0, FRAME_SAMPLES * 3)));
    expect(f.push(new Int16Array(FRAME_SAMPLES - 100))).toHaveLength(1); // the carried 100 complete a frame
    expect(level(Int16Array.from([0, -16384, 100]))).toBe(0.5);
  });
});
