// Footprint during a recorded meeting (Fake AI, real capture path, live captions): the PRD's
// target is under 15% CPU and under 500 MB RAM. CI runs 30 s; the full check is 60 minutes:
//   COPILOT_PERF_MINUTES=60 pnpm -C apps/desktop test:perf

import { expect, test, type ElectronApplication } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp, startBackend, windowByTitle } from "./helpers";

const MINUTES = Number(process.env.COPILOT_PERF_MINUTES ?? 0.5);
const CPU_LIMIT = 15; // % of the whole machine
const RAM_LIMIT_MB = 500;

/**
 * Memory that's really the app's: shared libraries are counted once across processes. Linux:
 * proportional set size (PSS); Windows: private bytes; elsewhere the working set (an overcount).
 */
function footprintKb(p: { pid: number; privateKb: number | null; wsKb: number }): number {
  if (process.platform === "linux") {
    try {
      const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${p.pid}/smaps_rollup`, "utf8"));
      if (m) return Number(m[1]);
    } catch {
      /* process gone */
    }
  }
  return p.privateKb ?? p.wsKb;
}

let backend: { url: string; proc: ChildProcess };
let app: ElectronApplication;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "copilot-perf-"));
  backend = await startBackend();
});

test.afterAll(async () => {
  await app?.close();
  backend?.proc.kill();
  rmSync(dir, { recursive: true, force: true });
});

test(`stays under ${CPU_LIMIT}% CPU and ${RAM_LIMIT_MB} MB while recording`, async () => {
  test.setTimeout((MINUTES * 60 + 120) * 1000);
  app = await launchApp(dir, { COPILOT_SKIP_SETUP: "1" });
  const main = await windowByTitle(app, "Meeting Copilot");
  await main.evaluate((url) => window.copilot.setSettings({ backendUrl: url }), backend.url);
  await main.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await main.getByRole("button", { name: "Use the local dev login" }).click();
  await main.getByRole("navigation").getByRole("link", { name: "Start meeting" }).click();
  await main.getByLabel("Title").fill("Perf run");
  await main.getByRole("button", { name: "Start recording" }).click();
  const overlay = await windowByTitle(app, "Meeting Copilot overlay");
  await expect(overlay.getByTestId("caption-line")).toContainText("Morning everyone", { timeout: 30_000 });

  // Let the first-start work settle, then sample every 5 s.
  await new Promise((r) => setTimeout(r, 5000));
  await app.evaluate(({ app }) => app.getAppMetrics()); // resets the CPU counters
  const samples: { cpu: number; ramMb: number }[] = [];
  const end = Date.now() + MINUTES * 60_000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 5000));
    const m = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({ pid: p.pid, cpu: p.cpu.percentCPUUsage, privateKb: p.memory.privateBytes ?? null, wsKb: p.memory.workingSetSize })),
    );
    samples.push({ cpu: m.reduce((a, p) => a + p.cpu, 0), ramMb: m.reduce((a, p) => a + footprintKb(p), 0) / 1024 });
  }
  const breakdown = await app.evaluate(({ app }) => app.getAppMetrics().map((p) => `${p.type}${p.name ? `:${p.name}` : ""} ${Math.round(p.memory.workingSetSize / 1024)}MB`));
  console.log("[perf] processes", breakdown.join(", "));
  await main.getByRole("button", { name: "Stop recording" }).click();

  // percentCPUUsage is per core; the target is for the whole machine.
  const cores = cpus().length;
  const avgCpu = samples.reduce((a, s) => a + s.cpu, 0) / samples.length / cores;
  const peakRam = Math.max(...samples.map((s) => s.ramMb));
  const report = { minutes: MINUTES, cores, samples: samples.length, avgCpuPercent: +avgCpu.toFixed(2), avgCpuOneCore: +(avgCpu * cores).toFixed(1), peakRamMb: Math.round(peakRam) };
  writeFileSync(join(import.meta.dirname, "..", "test-results", "perf.json"), JSON.stringify(report, null, 2));
  console.log("[perf]", JSON.stringify(report));
  expect(avgCpu).toBeLessThan(CPU_LIMIT);
  expect(peakRam).toBeLessThan(RAM_LIMIT_MB);
});
