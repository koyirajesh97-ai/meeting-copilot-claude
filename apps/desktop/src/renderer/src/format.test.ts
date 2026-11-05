import { describe, expect, it } from "vitest";
import { formatElapsed, greeting, relativeTime, timeUntil } from "./format";

describe("formatElapsed", () => {
  it.each([
    [0, "00:00"],
    [65_000, "01:05"],
    [3_725_000, "1:02:05"],
    [-5, "00:00"],
  ])("%d ms -> %s", (ms, out) => expect(formatElapsed(ms)).toBe(out));
});

describe("friendly times", () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  it.each([
    [now / 1000 - 20, "just now"],
    [now / 1000 - 300, "5 min ago"],
    [now / 1000 - 3600, "1 hour ago"],
    [now / 1000 - 3 * 3600, "3 hours ago"],
    [now / 1000 - 86400 - 60, "yesterday"],
    [now / 1000 - 4 * 86400, "4 days ago"],
  ])("relativeTime(%d)", (t, out) => expect(relativeTime(t, now)).toBe(out));
  it.each([
    [now / 1000 - 30, "now"],
    [now / 1000 + 5 * 60, "in 5 min"],
    [now / 1000 + 130 * 60, "in 2 h 10 min"],
    [now / 1000 + 120 * 60, "in 2 h"],
  ])("timeUntil(%d)", (t, out) => expect(timeUntil(t, now)).toBe(out));
  it("greets by time of day", () => {
    expect(greeting(new Date(2026, 10, 5, 9))).toBe("Good morning");
    expect(greeting(new Date(2026, 10, 5, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 10, 5, 20))).toBe("Good evening");
  });
});
