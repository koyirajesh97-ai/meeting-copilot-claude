import { describe, expect, it } from "vitest";
import { AudioChannel, FRAME_BYTES } from "./index";

describe("wire constants", () => {
  it("matches the PRD audio format", () => {
    expect(FRAME_BYTES).toBe((16000 * 0.02) * 2);
    expect(AudioChannel.Mic).toBe(0);
    expect(AudioChannel.System).toBe(1);
  });
});
