// Runs against a packaged build (after `pnpm dist:linux` or on the Windows test machine):
//   COPILOT_PACKAGED_APP=release/linux-unpacked/meeting-copilot pnpm -C apps/desktop exec playwright test e2e/packaged.spec.ts
// Checks what packaging can break: the app starts, the first-run setup shows, and recording works
// with Silero VAD loaded from inside the archive.

import { expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchApp, windowByTitle } from "./helpers";

const exe = process.env.COPILOT_PACKAGED_APP;
test.skip(!exe, "set COPILOT_PACKAGED_APP to a packaged build");

test("the packaged app starts, shows setup and records with Silero", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-packaged-"));
  const app = await launchApp(dir, {}, resolve(exe!));
  try {
    const main = await windowByTitle(app, "Meeting Copilot");
    await expect(main.getByRole("heading", { name: "Set up Meeting Copilot" })).toBeVisible();
    await main.getByRole("button", { name: "Skip setup" }).click();
    await main.getByRole("navigation").getByRole("link", { name: "Start meeting" }).click();
    await main.getByRole("button", { name: "Start recording" }).click();
    await expect.poll(async () => (await main.evaluate(() => window.copilot.getState())).audio.mic.source ?? "", { timeout: 20_000 }).toContain("vad: silero");
    await new Promise((r) => setTimeout(r, 1500));
    await main.getByRole("button", { name: "Stop recording" }).click();
    const recordings = join(dir, "recordings");
    const latest = readdirSync(recordings).sort().at(-1)!;
    expect(existsSync(join(recordings, latest, "mic.wav"))).toBe(true);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
