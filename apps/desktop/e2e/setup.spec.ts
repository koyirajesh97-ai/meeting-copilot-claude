// First run on a clean profile: setup opens by itself, checks audio, signs in, tests and saves an
// AI key on the (local) backend, sets the role and default mode, then records a meeting.

import { expect, test, type ElectronApplication } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp, startBackend, windowByTitle } from "./helpers";

let backend: { url: string; proc: ChildProcess };
let app: ElectronApplication;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "copilot-setup-e2e-"));
  writeFileSync(join(dir, ".env"), "GROQ_API_KEY=\n");
  backend = await startBackend({ COPILOT_ENV_FILE: join(dir, ".env"), GROQ_API_KEY: "" });
});

test.afterAll(async () => {
  await app?.close();
  backend?.proc.kill();
  rmSync(dir, { recursive: true, force: true });
});

test("first-run setup (sign in, keys, audio, about you), then a meeting end to end", async () => {
  test.setTimeout(120_000);
  app = await launchApp(join(dir, "profile"), { COPILOT_AUDIO_CHECK_MS: "2500" });
  const main = await windowByTitle(app, "Meeting Copilot");
  await main.evaluate((url) => window.copilot.setSettings({ backendUrl: url }), backend.url);
  await expect(main.getByRole("heading", { name: "Welcome to Meeting Copilot" })).toBeVisible();
  // Setup has the window to itself.
  await expect(main.getByRole("navigation")).toBeHidden();

  // 1. Sign in (local dev login).
  await main.getByRole("button", { name: "Use the local dev login" }).click();
  await expect(main.getByTestId("signed-in-as")).toContainText("dev@localhost");

  // 2. The server has no AI keys yet, so the key step appears: a bad key is rejected, a good one
  // is tested and saved on the backend.
  await main.getByRole("button", { name: "Next" }).click();
  const groq = main.getByTestId("key-groq");
  await expect(groq).toContainText("No key yet");
  await groq.getByLabel("groq API key").fill("bad-key-bad-key");
  await groq.getByRole("button", { name: "Test and save" }).click();
  await expect(groq.getByRole("status")).toContainText("didn't work");
  await groq.getByLabel("groq API key").fill("gsk_e2e_working_key");
  await groq.getByRole("button", { name: "Test and save" }).click();
  await expect(groq.getByRole("status")).toContainText("saved on your backend");
  await expect(groq).toContainText("Key set");
  expect(readFileSync(join(dir, ".env"), "utf8")).toContain("GROQ_API_KEY=gsk_e2e_working_key");
  await expect(main.getByTestId("key-gemini")).toHaveCount(0); // optional fallbacks aren't asked for

  // 3. Audio check (the indicator is on while it listens).
  await main.getByRole("button", { name: "Next" }).click();
  await main.getByRole("button", { name: "Test audio" }).click();
  const overlay = await windowByTitle(app, "Meeting Copilot overlay");
  await expect(overlay.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "true");
  await expect(main.getByTestId("audio-result")).toContainText("Your microphone works", { timeout: 15_000 });
  await expect(main.getByTestId("audio-result")).toContainText("No meeting audio"); // no system audio on Linux CI
  await expect(overlay.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "false");

  // 4. About you, then finish.
  await main.getByRole("button", { name: "Next" }).click();
  await main.getByLabel("Your name (as people say it)").fill("Dev User");
  await main.getByLabel("Role preset").selectOption({ label: "DevOps/SRE" });
  await main.getByRole("button", { name: "Save" }).click();
  await expect(main.getByRole("button", { name: "Saved" })).toBeVisible();
  await main.getByRole("button", { name: "Finish" }).click();
  await expect(main.getByRole("heading", { name: "Meetings", level: 1 })).toBeVisible();
  await expect(main.getByRole("navigation")).toBeVisible();
  expect(await main.evaluate(() => window.copilot.getSettings())).toMatchObject({ setupDone: true });

  // The default meeting mode lives in Settings → General.
  await main.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await main.getByRole("tab", { name: "General" }).click();
  await main.getByRole("radio", { name: /Live-only/ }).click();
  await expect(main.getByRole("radio", { name: /Live-only/ })).toBeChecked();

  // A meeting, in the default mode chosen during setup.
  await main.getByRole("navigation").getByRole("link", { name: "Start meeting" }).click();
  await main.getByText("More options").click();
  await expect(main.getByRole("radio", { name: /Live-only/ })).toBeChecked();
  await main.getByRole("radio", { name: /^Cloud/ }).click();
  await main.getByLabel("Title").fill("After setup");
  await main.getByRole("button", { name: "Start recording" }).click();
  await expect(overlay.getByTestId("caption-line")).toContainText("Morning everyone", { timeout: 30_000 });
  await main.getByRole("button", { name: "Stop recording" }).click();
  await main.getByRole("navigation").getByRole("link", { name: "Meetings", exact: true }).click();
  await expect(main.getByRole("list", { name: "Meetings" }).getByRole("link", { name: /After setup/ })).toBeVisible({ timeout: 15_000 });

  // Restarting doesn't show setup again.
  await app.close();
  app = await launchApp(join(dir, "profile"));
  const again = await windowByTitle(app, "Meeting Copilot");
  await expect(again.getByRole("heading", { name: "Meetings", level: 1 })).toBeVisible();
});
