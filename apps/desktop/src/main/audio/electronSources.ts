// Electron-specific audio sources. The mic (all OSes) and macOS system audio are captured
// with web APIs in a hidden, sandboxed "capture" window and streamed to main over IPC.
// Windows (and Linux with PipeWire) system audio comes from the native loopback addon.

import { BrowserWindow, desktopCapturer, ipcMain, session, webContents, type IpcMainEvent } from "electron";
import { join } from "node:path";
import { IPC, type CaptureCommand, type CaptureReport, type ChannelName } from "../../shared/ipc";
import { findProcessId, loadNativeLoopback, NativeLoopbackSource, type AudioSource, type OnAudio } from "./sources";

const START_TIMEOUT_MS = 10_000;

export class CaptureWindowHost {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private readonly listeners = new Map<ChannelName, OnAudio>();
  private readonly waiting = new Map<ChannelName, (r: CaptureReport) => void>();

  constructor() {
    ipcMain.on(IPC.captureChunk, (e: IpcMainEvent, channel: unknown, samples: unknown, rate: unknown) => {
      if (!this.fromCaptureWindow(e)) return;
      if ((channel !== "mic" && channel !== "system") || !(samples instanceof Float32Array) || typeof rate !== "number") return;
      this.listeners.get(channel)?.(samples, rate);
    });
    ipcMain.on(IPC.captureStatus, (e: IpcMainEvent, report: CaptureReport) => {
      if (!this.fromCaptureWindow(e)) return;
      this.waiting.get(report.channel)?.(report);
    });
  }

  get webContentsId(): number | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents.id : null;
  }

  private fromCaptureWindow(e: IpcMainEvent): boolean {
    return this.webContentsId !== null && e.sender.id === this.webContentsId;
  }

  private ensureWindow(): Promise<void> {
    if (this.win && !this.win.isDestroyed() && this.ready) return this.ready;
    const win = new BrowserWindow({
      show: false,
      width: 200,
      height: 100,
      title: "Meeting Copilot capture",
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Hidden windows are throttled by default; audio must keep flowing.
        backgroundThrottling: false,
      },
    });
    this.win = win;
    const dev = process.env.ELECTRON_RENDERER_URL;
    this.ready = (dev ? win.loadURL(`${dev}/capture.html`) : win.loadFile(join(import.meta.dirname, "../renderer/capture.html"))).then(() => undefined);
    win.on("closed", () => {
      this.win = null;
      this.ready = null;
    });
    return this.ready;
  }

  async startChannel(channel: ChannelName, onAudio: OnAudio, deviceId?: string | null): Promise<void> {
    await this.ensureWindow();
    this.listeners.set(channel, onAudio);
    const report = await new Promise<CaptureReport>((resolve) => {
      const timer = setTimeout(() => resolve({ channel, state: "error", message: "Capture didn't start in time" }), START_TIMEOUT_MS);
      this.waiting.set(channel, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.send({ action: "start", channel, deviceId });
    });
    this.waiting.delete(channel);
    if (report.state !== "live") {
      this.listeners.delete(channel);
      throw new Error(report.message ?? `${channel} capture is ${report.state}`);
    }
  }

  stopChannel(channel: ChannelName): void {
    this.listeners.delete(channel);
    this.send({ action: "stop", channel });
  }

  private send(cmd: CaptureCommand): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(IPC.captureCommand, cmd);
  }
}

export class RendererSource implements AudioSource {
  readonly name: string;
  constructor(
    private readonly host: CaptureWindowHost,
    private readonly channel: ChannelName,
    private readonly deviceId: string | null = null,
  ) {
    this.name = `renderer-${channel}`;
  }
  start(onAudio: OnAudio): Promise<void> {
    return this.host.startChannel(this.channel, onAudio, this.deviceId);
  }
  async stop(): Promise<void> {
    this.host.stopChannel(this.channel);
  }
}

/**
 * Answer the capture window's getDisplayMedia() with system-audio loopback (used on macOS
 * 14.2+, and on Windows if the native addon is missing). Any other window is refused.
 */
export function installDisplayMediaHandler(host: CaptureWindowHost): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const wc = request.frame ? webContents.fromFrame(request.frame) : undefined;
      const fromCapture = host.webContentsId !== null && wc?.id === host.webContentsId;
      if (!fromCapture) {
        callback({});
        return;
      }
      void desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        // A video source is required by the API; the capture page stops the video track at once.
        callback(sources[0] ? { video: sources[0], audio: "loopback" } : {});
      });
    },
    { useSystemPicker: false },
  );
}

/** Pick the system-audio source for this OS. */
export async function systemSourceFor(host: CaptureWindowHost, appImageName: string | null): Promise<AudioSource | null> {
  if (process.platform === "win32" || process.platform === "linux") {
    const addon = loadNativeLoopback();
    if (addon) {
      let pid: number | null = null;
      if (appImageName && process.platform === "win32") {
        pid = await findProcessId(appImageName);
        if (!pid) throw new Error(`${appImageName} isn't running. Start the meeting app, or capture all system audio.`);
      }
      return new NativeLoopbackSource(addon, pid);
    }
    // Windows without the addon: Chromium's loopback still captures all system audio.
    return process.platform === "win32" ? new RendererSource(host, "system") : null;
  }
  if (process.platform === "darwin") return new RendererSource(host, "system");
  return null;
}
