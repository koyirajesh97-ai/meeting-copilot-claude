import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let userData: string;

async function windowByTitle(title: string): Promise<Page> {
  for (let i = 0; i < 50; i++) {
    for (const w of app.windows()) {
      if ((await w.title()) === title) return w;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No window titled ${title}`);
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "copilot-e2e-"));
  const args = [".", `--user-data-dir=${userData}`];
  // Chromium refuses to start as root (containers, CI) without this. The app's own
  // renderer sandbox settings are unchanged.
  if (process.getuid?.() === 0) args.push("--no-sandbox");
  app = await electron.launch({ args, cwd: join(import.meta.dirname, "..") });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

test("opens the main window with every route", async () => {
  const main = await windowByTitle("Meeting Copilot");
  await expect(main.getByRole("heading", { name: "Meetings" })).toBeVisible();
  for (const [link, heading] of [
    ["Start meeting", "Start meeting"],
    ["Ask my meetings", "Ask my meetings"],
    ["Standup prep", "Standup prep"],
    ["Projects", "Projects"],
    ["Settings", "Settings"],
  ]) {
    await main.getByRole("navigation").getByRole("link", { name: link }).click();
    await expect(main.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  }
  await main.evaluate(() => (location.hash = "#/meetings/m_123"));
  await expect(main.getByRole("heading", { name: "Meeting", level: 1 })).toBeVisible();
});

test("renderer is isolated: no Node, only the typed bridge", async () => {
  const main = await windowByTitle("Meeting Copilot");
  const probe = await main.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridge: Object.keys(window.copilot).sort(),
  }));
  expect(probe.require).toBe("undefined");
  expect(probe.process).toBe("undefined");
  expect(probe.bridge).toEqual(
    ["getSettings", "getState", "onState", "openMain", "overlay", "secrets", "setSettings", "toggleCapture"].sort(),
  );
});

test("overlay is always on top, never focusable, and shows the recording indicator", async () => {
  const main = await windowByTitle("Meeting Copilot");
  const overlay = await windowByTitle("Meeting Copilot overlay");

  const props = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.getTitle() === "Meeting Copilot overlay")
      .map((w) => ({ top: w.isAlwaysOnTop(), focusable: w.isFocusable(), size: w.getSize() })),
  );
  expect(props).toEqual([{ top: true, focusable: false, size: [360, 120] }]);

  const indicator = overlay.getByTestId("recording-indicator");
  await expect(indicator).toHaveAttribute("data-recording", "false");

  await main.getByRole("navigation").getByRole("link", { name: "Start meeting" }).click();
  await main.getByRole("button", { name: "Start recording" }).click();
  await expect(indicator).toHaveAttribute("data-recording", "true");
  await expect(main.getByTestId("recording-indicator")).toHaveAttribute("data-recording", "true");

  const visible = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Meeting Copilot overlay")?.isVisible(),
  );
  expect(visible).toBe(true);

  await main.getByRole("button", { name: "Stop recording" }).click();
  await expect(indicator).toHaveAttribute("data-recording", "false");
});

test("overlay expands to 360x520 and back", async () => {
  const overlay = await windowByTitle("Meeting Copilot overlay");
  const size = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Meeting Copilot overlay")!.getSize(),
    );
  await overlay.getByRole("button", { name: "Expand overlay" }).click();
  await expect(overlay.getByTestId("overlay")).toHaveAttribute("data-expanded", "true");
  expect(await size()).toEqual([360, 520]);
  await overlay.getByRole("button", { name: "Compact overlay" }).click();
  await expect(overlay.getByTestId("overlay")).toHaveAttribute("data-expanded", "false");
  expect(await size()).toEqual([360, 120]);
});

test("overlay action buttons respond (stubs for now)", async () => {
  const overlay = await windowByTitle("Meeting Copilot overlay");
  await overlay.getByRole("button", { name: "Catch me up" }).click();
  await expect(overlay.getByText("Catch me up is not connected yet.")).toBeVisible();
});

test("settings persist through the main process and are validated", async () => {
  const main = await windowByTitle("Meeting Copilot");
  const saved = await main.evaluate(() => window.copilot.setSettings({ captionFontSize: 99, theme: "dark" }));
  expect(saved.captionFontSize).toBe(28);
  expect(saved.theme).toBe("dark");
  await expect.poll(() => main.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
});
