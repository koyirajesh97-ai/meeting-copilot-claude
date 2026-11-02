import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isAllowedRoute } from "../shared/ipc";
import { contentSecurityPolicy } from "./csp";
import { clampToWorkArea, defaultOverlayPosition, OVERLAY_SIZE } from "./geometry";
import { HOTKEYS } from "./hotkeys";
import { applySettingsPatch, loadSettings } from "./settingsSanitize";

const work = { x: 0, y: 0, width: 1920, height: 1040 };

describe("overlay geometry", () => {
  it("uses the PRD sizes", () => {
    expect(OVERLAY_SIZE.compact).toEqual({ width: 360, height: 120 });
    expect(OVERLAY_SIZE.expanded).toEqual({ width: 360, height: 520 });
  });
  it("defaults to the top-right corner", () => {
    expect(defaultOverlayPosition(work, false)).toEqual({ x: 1920 - 360 - 16, y: 16 });
  });
  it("pulls an off-screen overlay back on screen", () => {
    expect(clampToWorkArea({ x: 5000, y: -50 }, false, work)).toEqual({ x: 1560, y: 0 });
  });
  it("moves up when expanding near the bottom edge", () => {
    expect(clampToWorkArea({ x: 100, y: 900 }, true, work)).toEqual({ x: 100, y: 520 });
  });
  it("handles a secondary monitor at negative coordinates", () => {
    const left = { x: -1280, y: 0, width: 1280, height: 1024 };
    expect(clampToWorkArea({ x: -2000, y: 10 }, false, left)).toEqual({ x: -1280, y: 10 });
  });
});

describe("hotkeys", () => {
  it("binds Ctrl/Cmd+Shift plus R, C, L, F, E exactly once each", () => {
    const keys = HOTKEYS.map((h) => h.accelerator);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.map((k) => k.at(-1)).sort()).toEqual(["C", "E", "F", "L", "R"]);
    expect(keys.every((k) => k.startsWith("CommandOrControl+Shift+"))).toBe(true);
  });
});

describe("content security policy", () => {
  it("is strict in production", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });
  it("allows only the Vite dev server in dev", () => {
    const csp = contentSecurityPolicy(true, "http://localhost:5173");
    expect(csp).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173");
    expect(csp).not.toContain("unsafe-eval");
  });
});

describe("settings", () => {
  it("fills defaults for empty or junk storage", () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings("junk")).toEqual(DEFAULT_SETTINGS);
  });
  it("drops unknown keys and invalid values", () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      theme: "neon",
      evil: true,
      backendUrl: "javascript:alert(1)",
      captionFontSize: Number.NaN,
      overlayPosition: { x: "1", y: 2 },
    });
    expect(next).toEqual(DEFAULT_SETTINGS);
  });
  it("accepts a Windows app name for per-app capture and rejects anything else", () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { systemAudioApp: " ms-teams.exe " }).systemAudioApp).toBe("ms-teams.exe");
    expect(applySettingsPatch(DEFAULT_SETTINGS, { systemAudioApp: "rm -rf /" }).systemAudioApp).toBeNull();
    expect(applySettingsPatch({ ...DEFAULT_SETTINGS, systemAudioApp: "Zoom.exe" }, { systemAudioApp: "" }).systemAudioApp).toBeNull();
    expect(applySettingsPatch(DEFAULT_SETTINGS, { micDeviceId: "abc123" }).micDeviceId).toBe("abc123");
    expect(applySettingsPatch(DEFAULT_SETTINGS, { micDeviceId: 5 }).micDeviceId).toBeNull();
  });

  it("clamps caption size and rounds positions", () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      captionFontSize: 3,
      overlayPosition: { x: 10.6, y: 20.2 },
      theme: "dark",
      backendUrl: "https://copilot.example.com",
    });
    expect(next.captionFontSize).toBe(11);
    expect(next.overlayPosition).toEqual({ x: 11, y: 20 });
    expect(next.theme).toBe("dark");
    expect(next.backendUrl).toBe("https://copilot.example.com");
  });
});

describe("routes", () => {
  it("allows known routes and meeting detail paths only", () => {
    expect(isAllowedRoute("/")).toBe(true);
    expect(isAllowedRoute("/settings")).toBe(true);
    expect(isAllowedRoute("/meetings/m_123")).toBe(true);
    expect(isAllowedRoute("/meetings/:id")).toBe(false);
    expect(isAllowedRoute("https://evil.example")).toBe(false);
    expect(isAllowedRoute("/meetings/../../etc")).toBe(false);
  });
});
