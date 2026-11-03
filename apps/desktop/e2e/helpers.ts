// Shared by the end-to-end specs: a real backend (Fake AI providers) and the app with a WAV as mic.

import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..", "..");
export const SPEECH = join(ROOT, "evals", "fixtures", "audio", "speech-16k.wav");

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export async function startBackend(env: Record<string, string> = {}): Promise<{ url: string; proc: ChildProcess }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const proc = spawn("uv", ["run", "-q", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: join(ROOT, "services", "backend"),
    env: {
      ...process.env,
      ALLOW_DEV_LOGIN: "1",
      COPILOT_FAKE_PROVIDERS: "1",
      BACKEND_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      DATABASE_URL: "",
      ...env,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return { url, proc };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("backend didn't start");
}

export async function launchApp(userData: string, env: Record<string, string> = {}, executablePath?: string): Promise<ElectronApplication> {
  const args = [
    ...(executablePath ? [] : ["."]),
    `--user-data-dir=${userData}`,
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${SPEECH}`,
  ];
  if (process.getuid?.() === 0) args.push("--no-sandbox");
  return electron.launch({ args, executablePath, cwd: join(import.meta.dirname, ".."), env: { ...process.env, COPILOT_NO_UPDATE: "1", ...env } });
}

export async function windowByTitle(app: ElectronApplication, title: string): Promise<Page> {
  for (let i = 0; i < 75; i++) {
    for (const w of app.windows()) if ((await w.title()) === title) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No window titled ${title}`);
}
