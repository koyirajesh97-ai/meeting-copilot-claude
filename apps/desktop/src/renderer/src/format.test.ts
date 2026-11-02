import { describe, expect, it } from "vitest";
import { formatElapsed } from "./format";

describe("formatElapsed", () => {
  it.each([
    [0, "00:00"],
    [65_000, "01:05"],
    [3_725_000, "1:02:05"],
    [-5, "00:00"],
  ])("%d ms -> %s", (ms, out) => expect(formatElapsed(ms)).toBe(out));
});
