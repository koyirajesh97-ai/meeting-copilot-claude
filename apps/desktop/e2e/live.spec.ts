// End to end: desktop app + real backend (fake AI providers) + a WAV file as the microphone.
// Record a meeting, see live captions, stop, find the transcript in Meetings home, then restart
// the app with the backend down and find it again (served from the local cache).

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SPEECH = join(ROOT, "evals", "fixtures", "audio", "speech-16k.wav");

let backend: ChildProcess | null = null;
let backendUrl = "";
let userData = "";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function startBackend(): Promise<void> {
  const port = await freePort();
  backendUrl = `http://127.0.0.1:${port}`;
  backend = spawn("uv", ["run", "-q", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: join(ROOT, "services", "backend"),
    env: {
      ...process.env,
      ALLOW_DEV_LOGIN: "1",
      COPILOT_FAKE_PROVIDERS: "1",
      BACKEND_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      DATABASE_URL: "",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${backendUrl}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("backend didn't start");
}

async function launch(): Promise<ElectronApplication> {
  const args = [
    ".",
    `--user-data-dir=${userData}`,
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    // The fake microphone plays this file (looping): real speech, so Silero lets it through.
    `--use-file-for-fake-audio-capture=${SPEECH}`,
  ];
  if (process.getuid?.() === 0) args.push("--no-sandbox");
  return electron.launch({ args, cwd: join(import.meta.dirname, "..") });
}

async function windowByTitle(app: ElectronApplication, title: string): Promise<Page> {
  for (let i = 0; i < 50; i++) {
    for (const w of app.windows()) if ((await w.title()) === title) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No window titled ${title}`);
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "copilot-live-e2e-"));
  await startBackend();
});

test.afterAll(() => {
  backend?.kill();
  rmSync(userData, { recursive: true, force: true });
});

test("record a meeting with live captions, then find its transcript after a restart", async () => {
  test.setTimeout(120_000);
  let app = await launch();
  let main = await windowByTitle(app, "Meeting Copilot");
  const overlay = await windowByTitle(app, "Meeting Copilot overlay");

  // Point the app at this backend and sign in with the dev login.
  await main.evaluate((url) => window.copilot.setSettings({ backendUrl: url }), backendUrl);
  await main.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await main.getByRole("button", { name: "Use the local dev login" }).click();
  await expect(main.getByTestId("signed-in-as")).toContainText("dev@localhost");

  // Start a meeting from the Start meeting screen.
  await main.getByRole("navigation").getByRole("link", { name: "Start meeting" }).click();
  await main.getByLabel("Title").fill("E2E standup");
  await main.getByRole("button", { name: "Start recording" }).click();

  // Live: the backend's (fake) transcriber turns the mic audio into captions in the overlay.
  await expect(overlay.getByTestId("live-status")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
  await expect(overlay.getByTestId("caption-line")).toContainText("You: Morning everyone", { timeout: 30_000 });
  await overlay.getByRole("button", { name: "Expand overlay" }).click();
  await expect(overlay.getByTestId("caption-final").first()).toContainText("Morning everyone, let's start the standup.");
  await expect(overlay.getByTestId("captions")).toHaveAttribute("data-pinned", "true");

  // Let a second line arrive, then stop.
  await expect(overlay.getByTestId("caption-final").nth(1)).toBeVisible({ timeout: 30_000 });
  await main.getByRole("button", { name: "Stop recording" }).click();
  await expect(overlay.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "false", { timeout: 15_000 });

  // Meetings home lists it with its transcript.
  await main.getByRole("navigation").getByRole("link", { name: "Meetings", exact: true }).click();
  const row = main.getByRole("list", { name: "Meetings" }).getByRole("link", { name: /E2E standup/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(main.getByRole("heading", { name: "E2E standup", level: 1 })).toBeVisible();
  const lines = main.getByTestId("transcript-line");
  await expect(lines.first()).toContainText("You:Morning everyone, let's start the standup.");
  const count = await lines.count();

  // The summary arrives shortly after the meeting ends (standup template: per-person updates).
  const summary = main.getByTestId("summary");
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).toContainText("Yesterday I finished the certificate renewal");
  // Regenerate with another template.
  await main.getByLabel("Template").selectOption("incident");
  await main.getByRole("button", { name: "Regenerate" }).click();
  await expect(summary.getByRole("heading", { name: "Timeline" })).toBeVisible({ timeout: 30_000 });

  // Ask my meetings: a cited answer whose citation opens the meeting at that moment.
  await main.getByRole("navigation").getByRole("link", { name: "Ask my meetings" }).click();
  await main.getByLabel("Question").fill("Who finished the certificate renewal?");
  await main.getByRole("button", { name: "Ask" }).click();
  const answer = main.getByTestId("answer");
  await expect(answer).toHaveAttribute("data-found", "true", { timeout: 20_000 });
  await expect(answer).toContainText("certificate renewal");
  await answer.getByTestId("citation").filter({ hasText: / at \d\d:\d\d/ }).first().click();
  await expect(main.getByRole("heading", { name: "E2E standup", level: 1 })).toBeVisible();
  const highlighted = main.locator('[data-testid="transcript-line"][data-highlight="true"]');
  await expect(highlighted).toHaveCount(1);
  expect(count).toBeGreaterThanOrEqual(2);


  // Restart with the backend down: the transcript comes from the local cache.
  await app.close();
  backend?.kill();
  backend = null;
  app = await launch();
  main = await windowByTitle(app, "Meeting Copilot");
  await main.getByRole("list", { name: "Meetings" }).getByRole("link", { name: /E2E standup/ }).click();
  await expect(main.getByTestId("transcript-line")).toHaveCount(count);
  await expect(main.getByTestId("summary").getByRole("heading", { name: "Timeline" })).toBeVisible();
  await app.close();
});
