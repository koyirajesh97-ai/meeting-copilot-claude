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
  return electron.launch({
    args,
    cwd: join(import.meta.dirname, ".."),
    env: { ...process.env, COPILOT_ENROLL_SECONDS: "10" },
  });
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
  test.setTimeout(180_000);
  let app = await launch();
  let main = await windowByTitle(app, "Meeting Copilot");
  const overlay = await windowByTitle(app, "Meeting Copilot overlay");

  // Point the app at this backend and sign in with the dev login.
  await main.evaluate((url) => window.copilot.setSettings({ backendUrl: url }), backendUrl);
  await main.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await main.getByRole("button", { name: "Use the local dev login" }).click();
  await expect(main.getByTestId("signed-in-as")).toContainText("dev@localhost");

  // Integrations (Fake adapters): a calendar, Jira and a Slack webhook.
  const google = main.getByTestId("integration-google");
  await google.getByLabel("Use Google Calendar").check();
  await expect(google).toContainText("Connected");
  const jira = main.getByTestId("integration-jira");
  await jira.getByLabel("Jira site").fill("https://team.atlassian.net");
  await jira.getByLabel("Jira email").fill("dev@example.com");
  await jira.getByLabel("Jira API token").fill("token");
  await jira.getByRole("button", { name: "Save" }).click();
  await expect(jira).toContainText("Connected");
  const slack = main.getByTestId("integration-slack");
  await slack.getByLabel("Slack webhook URL").fill("https://example.com/not-slack");
  await slack.getByRole("button", { name: "Save" }).click();
  await expect(main.getByTestId("integrations-note")).toContainText("isn't a Slack webhook URL");
  await slack.getByLabel("Slack webhook URL").fill("https://hooks.slack.com/services/T0/B0/X");
  await slack.getByRole("button", { name: "Save" }).click();
  await expect(slack).toContainText("Connected");

  // Your role: pick a preset, fill in names and systems, save, and see it come back.
  await main.getByRole("navigation").getByRole("link", { name: "Your role" }).click();
  await main.getByLabel("Start from a preset").selectOption("devops_sre");
  await expect(main.getByLabel("Role title")).toHaveValue("DevOps/SRE");
  await main.getByLabel("Your name (as people say it)").fill("Dev User");
  await main.getByLabel("Systems you own").fill("payments cluster, ArgoCD");
  await main.getByLabel("Systems you own").blur();
  await main.getByRole("button", { name: "Save" }).click();
  await expect(main.getByRole("status")).toHaveText("Saved");
  const saved = await main.evaluate(() => window.copilot.profile.get());
  expect(saved).toMatchObject({ name: "Dev User", title: "DevOps/SRE", systems_owned: ["payments cluster", "ArgoCD"] });

  // Standup prep: rough notes in, done / doing / blockers and a script out.
  await main.getByRole("navigation").getByRole("link", { name: "Standup prep" }).click();
  await expect(main.getByTestId("jira-tickets")).toContainText("OPS-150");
  await main.getByLabel("Standup notes").fill("finished OPS-142 cert renewal\ntoday moving the prod deploy\nblocked on VPN access");
  await main.getByRole("button", { name: "Make my update" }).click();
  await expect(main.getByTestId("standup-script")).toHaveValue(/OPS-142/, { timeout: 15_000 });
  await expect(main.getByTestId("standup-blockers")).toHaveValue(/VPN/);

  // Enroll a voice: consent is required, the indicator shows while recording, and it can be deleted.
  await main.getByRole("navigation").getByRole("link", { name: "Your voice" }).click();
  const record = main.getByRole("button", { name: /Record \d+ seconds/ });
  await expect(record).toBeDisabled();
  await main.getByLabel("I agree to a voiceprint").check();
  await main.getByLabel("Name to show").fill("Dev User");
  await record.click();
  await expect(main.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "true");
  await expect(main.getByTestId("enrolled-voice")).toContainText("Dev User", { timeout: 30_000 });
  await expect(main.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "false");
  await main.getByRole("button", { name: "Delete my voiceprint" }).click();
  await expect(main.getByTestId("enrolled-voice")).toHaveCount(0);

  // A project with a pending invite and key terms; the meeting is shared with it.
  await main.getByRole("navigation").getByRole("link", { name: "Projects" }).click();
  await main.getByLabel("New project name").fill("Payments");
  await main.getByRole("button", { name: "Create" }).click();
  await main.getByRole("list", { name: "Projects" }).getByRole("link", { name: /Payments/ }).click();
  await expect(main.getByRole("heading", { name: "Payments", level: 1 })).toBeVisible();
  await main.getByLabel("Invite by email").fill("teammate@example.com");
  await main.getByRole("button", { name: "Invite" }).click();
  await expect(main.getByTestId("members")).toContainText("teammate@example.com");
  await main.getByRole("textbox", { name: "Key terms" }).fill("OPS-142\nKubernetes");
  await main.getByRole("button", { name: "Save terms" }).click();
  await expect(main.getByRole("button", { name: "Save terms" })).toBeHidden();
  await expect(main.getByTestId("board")).toContainText("Nothing here");

  // Meetings home shows the calendar; starting from an event fills in its title and type.
  await main.getByRole("navigation").getByRole("link", { name: "Meetings", exact: true }).click();
  const upcoming = main.getByTestId("upcoming").filter({ hasText: "Payments daily standup" });
  await expect(upcoming).toContainText("Standup");
  await upcoming.getByRole("link", { name: "Start" }).click();
  await expect(main.getByTestId("from-calendar")).toContainText("Payments daily standup");
  await expect(main.getByLabel("Title")).toHaveValue("Payments daily standup");
  await expect(main.getByLabel("Meeting type")).toHaveValue("standup");

  // Start it, in the project and shared with it.
  await main.getByLabel("Title").fill("E2E standup");
  await main.getByRole("combobox", { name: "Project", exact: true }).selectOption({ label: "Payments" });
  await main.getByLabel("Share with the project").check();
  // Announce before starting: the message is copied and logged once the meeting exists.
  await main.getByLabel("Consent message").fill("We're recording this standup for notes. Say so if that's not OK.");
  await main.getByRole("button", { name: "Announce" }).click();
  await expect(main.getByRole("button", { name: /Copied/ })).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain("We're recording this standup");
  await main.getByRole("button", { name: "Start recording" }).click();

  // Live: the backend's (fake) transcriber turns the mic audio into captions in the overlay.
  await expect(overlay.getByTestId("live-status")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
  await expect(overlay.getByTestId("caption-line")).toContainText("You: Morning everyone", { timeout: 30_000 });

  // Pause stops capture at once; Resume asks first.
  await overlay.getByRole("button", { name: "Pause" }).click();
  await expect(overlay.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "paused");
  await overlay.getByRole("button", { name: "Resume" }).click();
  await overlay.getByRole("button", { name: "Cancel" }).click();
  await expect(overlay.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "paused");
  await overlay.getByRole("button", { name: "Resume" }).click();
  await overlay.getByRole("button", { name: "Yes, resume" }).click();
  await expect(overlay.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "true");
  await overlay.getByRole("button", { name: "Expand overlay" }).click();
  await expect(overlay.getByTestId("caption-final").first()).toContainText("Morning everyone, let's start the standup.");
  await expect(overlay.getByTestId("captions")).toHaveAttribute("data-pinned", "true");

  // Let a second line arrive.
  await expect(overlay.getByTestId("caption-final").nth(1)).toBeVisible({ timeout: 30_000 });

  // Overlay actions during the meeting come back as cards.
  await overlay.getByRole("button", { name: "Catch me up" }).click();
  const catchUp = overlay.locator('[data-testid="card"][data-kind="catch_up"]');
  await expect(catchUp).toContainText("Last 2 min:", { timeout: 15_000 });
  await expect(catchUp).toContainText("Morning everyone");
  await overlay.getByRole("button", { name: "Clarify" }).click();
  // Only the mic has audio on this test machine, so nobody else has spoken.
  await expect(overlay.locator('[data-testid="card"][data-kind="clarify"]')).toContainText("No one else has spoken yet.", { timeout: 15_000 });
  await overlay.locator('[data-testid="card"][data-kind="catch_up"]').getByRole("button", { name: "Used" }).click();
  await expect(overlay.locator('[data-testid="card"][data-kind="catch_up"]').getByRole("button", { name: "Used" })).toHaveAttribute("aria-pressed", "true");

  // Stop.
  await main.getByRole("button", { name: "Stop recording" }).click();
  await expect(overlay.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "false", { timeout: 15_000 });

  // Meetings home lists it with its transcript.
  await main.getByRole("navigation").getByRole("link", { name: "Meetings", exact: true }).click();
  const row = main.getByRole("list", { name: "Meetings" }).getByRole("link", { name: /E2E standup/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(main.getByRole("heading", { name: "E2E standup", level: 1 })).toBeVisible();
  await expect(main.getByLabel("Sharing")).toHaveValue(/\|project$/);
  // The announcement, the pause and the resume are in the meeting's consent log.
  const meetingId = (await main.evaluate(() => location.hash)).split("/").pop()!;
  const { token } = (await (await fetch(`${backendUrl}/auth/dev-session`, { method: "POST" })).json()) as { token: string };
  const consent = (await (await fetch(`${backendUrl}/meetings/${meetingId}/consent`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { kind: string }[];
  expect(consent.map((e) => e.kind)).toEqual(["announced", "paused", "resumed"]);
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

  // Post the summary to Slack: preview (editable) first, then confirm.
  await main.getByRole("button", { name: "Post to Slack…" }).click();
  await expect(main.getByLabel("Post preview")).toHaveValue(/^# E2E standup/);
  await main.getByRole("button", { name: "Post to Slack", exact: true }).click();
  await expect(main.getByTestId("post-summary")).toContainText("Posted to Slack.");

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

  // Settings → Privacy shows each provider's data policy; test-only ones are off for meeting data.
  await main.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  const gemini = main.getByTestId("providers").locator('[data-provider="gemini"]');
  await expect(gemini).toContainText("May train on data");
  await expect(gemini).toContainText("Test data only");
  await expect(main.getByLabel("Allow test-only providers for meeting data")).not.toBeChecked();

  // The next meeting of the series gets a brief about the last one.
  await main.getByRole("navigation").getByRole("link", { name: "Start meeting" }).click();
  await main.getByLabel("Title").fill("E2E standup");
  await expect(main.getByTestId("brief")).toContainText("Last time (E2E standup)", { timeout: 10_000 });
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
