import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  session,
  Tray,
  type IpcMainInvokeEvent,
  type WebFrameMain,
} from "electron";
import { join } from "node:path";
import { ENROLL_SECONDS, IPC, isAllowedRoute, type AppState, type AudioLevels, type OverlayAction, type StartOptions } from "../shared/ipc";
import { AudioCapture, OFF, repairRecordings } from "./audio/capture";
import { CaptureWindowHost, installDisplayMediaHandler, RendererSource, systemSourceFor } from "./audio/electronSources";
import { recordMic } from "./audio/enroll";
import { SileroDetector } from "./audio/silero";
import { wavBytes } from "./audio/wav";
import { AuthManager, SIGNED_OUT } from "./backend/auth";
import { Cache } from "./backend/cache";
import { BackendClient } from "./backend/client";
import { LiveConnection } from "./backend/live";
import { syncAll, syncMeeting, waitForSummary } from "./backend/sync";
import { writeFile } from "node:fs/promises";
import { contentSecurityPolicy } from "./csp";
import { HOTKEYS, type HotkeyCommand } from "./hotkeys";
import { trayIcons } from "./icons";
import { sanitizeStartOptions } from "./startOptions";
import { deleteSecret, getSettings, hasSecret, secretBox, setSecret, updateSettings } from "./store";
import { createMainWindow, createOverlayWindow, navigateMain, resizeOverlay } from "./windows";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const state: AppState = {
  capturing: false,
  captureStartedAt: null,
  overlayExpanded: false,
  lastAction: null,
  audio: { mic: OFF, system: OFF },
  enrolling: false,
  auth: SIGNED_OUT,
  live: { status: "off", meetingId: null },
};

// Hidden capture windows have no user gesture; let their AudioContext start anyway.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.platform === "darwin") {
  // System-audio loopback for getDisplayMedia on macOS 14.2+.
  app.commandLine.appendSwitch("enable-features", "MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride");
}

let capture: AudioCapture | null = null;
let captureHost: CaptureWindowHost | null = null;
/** Serializes start/stop so rapid toggles can't interleave. */
let captureOp: Promise<unknown> = Promise.resolve();

function recordingsDir(): string {
  return join(app.getPath("userData"), "recordings");
}

function setupCapture(): void {
  captureHost = new CaptureWindowHost();
  installDisplayMediaHandler(captureHost);
  const host = captureHost;
  capture = new AudioCapture({
    recordingsDir: recordingsDir(),
    micSource: (deviceId) => new RendererSource(host, "mic", deviceId),
    systemSource: (app) => systemSourceFor(host, app),
    createDetector: () => SileroDetector.create(),
  });
  capture.on("status", (audio) => {
    state.audio = audio;
    broadcast();
  });
  capture.on("levels", (levels: AudioLevels) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.levels, levels);
    }
  });
  const fixed = repairRecordings(recordingsDir());
  if (fixed.length) console.warn(`[audio] repaired ${fixed.length} recording(s) left by a crash`);
}

// ---------- backend: auth, live meeting, cache, sync ----------

let cache: Cache | null = null;
let backend: BackendClient | null = null;
let auth: AuthManager | null = null;
let live: LiveConnection | null = null;
let liveMode: StartOptions["mode"] = "cloud";
const SYNC_EVERY_MS = 5 * 60_000;

function sendToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function setupBackend(): void {
  cache = new Cache(join(app.getPath("userData"), "cache.sqlite"));
  const a = (auth = new AuthManager(
    new BackendClient(() => getSettings().backendUrl, async () => null),
    getSettings,
    secretBox,
  ));
  backend = new BackendClient(() => getSettings().backendUrl, () => a.token());
  state.auth = a.state;
  a.on("change", (s) => {
    state.auth = s;
    broadcast();
    if (s.signedIn) void runSync();
  });

  const l = (live = new LiveConnection({ backend, outbound: capture!.outbound }));
  l.on("state", (s) => {
    state.live = s;
    broadcast();
  });
  l.on("meeting", (id, opts) => {
    liveMode = opts.mode;
    cache?.upsertMeeting({ id, title: opts.title, type: opts.type, mode: opts.mode, started_at: Date.now() / 1000, ended_at: null });
  });
  l.on("event", (event) => {
    sendToWindows(IPC.liveEvent, event);
    // Live-only: help during the call, nothing kept on disk.
    if (event.type === "transcript.final" && liveMode !== "live-only" && l.currentMeetingId) {
      cache?.upsertSegment(l.currentMeetingId, event);
    }
  });

  if (a.state.signedIn) void runSync();
  setInterval(() => auth?.state.signedIn && void runSync(), SYNC_EVERY_MS).unref();
}

async function runSync(): Promise<{ meetings: number; error?: string }> {
  if (!backend || !cache) return { meetings: 0, error: "not ready" };
  try {
    const n = await syncAll(backend, cache);
    sendToWindows(IPC.state, state);
    return { meetings: n };
  } catch (err) {
    return { meetings: cache.listMeetings().length, error: (err as Error).message };
  }
}

// ---------- state ----------

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.state, state);
  }
  refreshTray();
}

function showOverlay(): void {
  const win = ensureOverlay();
  // showInactive: appear without taking focus from the meeting app.
  if (!win.isVisible()) win.showInactive();
}

function setCapturing(on: boolean, options?: StartOptions): Promise<AppState> {
  const op = captureOp.then(async () => {
    if (state.capturing === on) return state;
    // The indicator turns on before any audio is read and off only after capture stops.
    if (on) {
      state.capturing = true;
      state.captureStartedAt = Date.now();
      showOverlay();
      broadcast();
      const settings = getSettings();
      await capture?.start({ micDeviceId: settings.micDeviceId, systemApp: settings.systemAudioApp });
      if (auth?.state.signedIn) {
        // Creating the meeting retries in the background; audio buffers locally meanwhile.
        void live?.start(options ?? sanitizeStartOptions(undefined));
      } else {
        state.live = { status: "local-only", meetingId: null, message: "Sign in (Settings) to get live captions. Recording locally." };
        broadcast();
      }
    } else {
      // Stop capture first so its last frames reach the outbound buffer, then end the meeting.
      const summary = await capture?.stop();
      if (summary) console.log(`[audio] saved recording to ${summary.dir}`);
      const id = await live?.stop();
      state.capturing = false;
      state.captureStartedAt = null;
      state.live = { status: "off", meetingId: null };
      broadcast();
      if (id && cache && backend) {
        cache.markEnded(id, Date.now() / 1000);
        // Fill in anything the live socket missed, then pick up the summary when it's ready.
        const b = backend;
        const c = cache;
        void syncMeeting(b, c, id)
          .then(() => sendToWindows(IPC.state, state))
          .then(() => waitForSummary(b, c, id))
          .then(() => sendToWindows(IPC.state, state))
          .catch((err) => console.warn("[sync] meeting sync failed:", (err as Error).message));
      }
    }
    return state;
  });
  captureOp = op.catch(() => undefined);
  return op;
}

function setExpanded(expanded: boolean): AppState {
  state.overlayExpanded = expanded;
  updateSettings({ overlayExpanded: expanded });
  if (overlayWindow && !overlayWindow.isDestroyed()) resizeOverlay(overlayWindow, expanded);
  broadcast();
  return state;
}

/** Catch me up / Clarify / I'll follow up: sent to the live meeting; the answer comes back as a card. */
function overlayAction(action: OverlayAction, minutes?: number): AppState {
  showOverlay();
  const sent = live?.send({ type: "control", action, ...(action === "catch_up" ? { minutes: minutes === 5 ? 5 : 2 } : {}) });
  // Without a live (signed-in) meeting there's nothing to act on; say so in the overlay.
  state.lastAction = sent ? null : { action, at: Date.now() };
  broadcast();
  return state;
}

function runHotkey(command: HotkeyCommand): void {
  switch (command) {
    case "toggle_capture":
      void setCapturing(!state.capturing);
      break;
    case "toggle_expand":
      showOverlay();
      setExpanded(!state.overlayExpanded);
      break;
    default:
      overlayAction(command);
  }
}

// ---------- windows ----------

function ensureMain(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = createMainWindow();
  // Closing the main window keeps the app in the tray; Quit is in the tray menu.
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  return mainWindow;
}

function openMain(route?: string): void {
  const win = ensureMain();
  if (route && isAllowedRoute(route)) navigateMain(win, route);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function ensureOverlay(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const settings = getSettings();
  overlayWindow = createOverlayWindow({
    expanded: state.overlayExpanded,
    position: settings.overlayPosition,
  });
  overlayWindow.on("moved", () => {
    if (!overlayWindow) return;
    const [x, y] = overlayWindow.getPosition();
    updateSettings({ overlayPosition: { x, y } });
  });
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
  return overlayWindow;
}

// ---------- tray ----------

function refreshTray(): void {
  if (!tray) return;
  const recording = state.capturing || state.enrolling;
  tray.setImage(recording ? trayIcons.recording() : trayIcons.idle());
  tray.setToolTip(recording ? "Meeting Copilot — recording" : "Meeting Copilot");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: state.capturing ? "Stop recording" : "Start recording",
        accelerator: "CommandOrControl+Shift+R",
        click: () => void setCapturing(!state.capturing),
      },
      { label: "Open Meeting Copilot", click: () => openMain() },
      { label: "Show overlay", click: () => showOverlay() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

function createTray(): void {
  tray = new Tray(trayIcons.idle());
  tray.on("click", () => openMain());
  refreshTray();
}

// ---------- security ----------

function isTrustedFrame(frame: WebFrameMain | null): boolean {
  if (!frame) return false;
  const url = frame.url;
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev) return url.startsWith(dev);
  return url.startsWith("file://");
}

function handle<T>(channel: string, fn: (...args: unknown[]) => T): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted IPC sender");
    return fn(...args);
  });
}

function hardenSessions(): void {
  const csp = contentSecurityPolicy(isDev, process.env.ELECTRON_RENDERER_URL);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] },
    });
  });
  // Only the microphone/system-audio capture (Prompt 3) and clipboard writes are ever allowed.
  const allowed = new Set(["media", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allowed.has(permission) && isTrustedFrame(wc.mainFrame));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL;
    const ok = dev ? url.startsWith(dev) : url.startsWith("file://");
    if (!ok) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

// ---------- IPC ----------

function registerIpc(): void {
  handle(IPC.getState, () => state);
  handle(IPC.toggleCapture, () => setCapturing(!state.capturing));
  handle(IPC.startMeeting, (opts) => setCapturing(true, sanitizeStartOptions(opts)));
  handle(IPC.authSendCode, (email) => auth!.sendCode(String(email)));
  handle(IPC.authVerifyCode, (email, code) => auth!.verifyCode(String(email), String(code)));
  handle(IPC.authDevAvailable, () => auth!.devAvailable());
  handle(IPC.authDevSignIn, () => auth!.devSignIn());
  handle(IPC.authSignOut, () => auth!.signOut());
  handle(IPC.meetingsList, () => cache!.listMeetings());
  handle(IPC.meetingsGet, (id) => (typeof id === "string" ? cache!.getMeeting(id) : null));
  handle(IPC.meetingsSync, () => runSync());
  handle(IPC.search, (q) => backend!.search(String(q).slice(0, 500)));
  handle(IPC.profileGet, () => backend!.getProfile());
  handle(IPC.standupGenerate, (notes) => backend!.standup(String(notes).slice(0, 4000)));
  handle(IPC.standupToday, () => backend!.standupToday());
  handle(IPC.standupSave, (edit) => backend!.saveStandup(edit as object));
  handle(IPC.brief, (title, type, agenda) => backend!.brief(String(title), String(type), String(agenda ?? "")));
  handle(IPC.profilePut, (p) => backend!.putProfile(p as never));
  handle(IPC.profilePresets, () => backend!.profilePresets());
  handle(IPC.cardFeedback, (cardId, useful) => {
    if (typeof cardId !== "string" || typeof useful !== "boolean") throw new Error("Bad feedback");
    if (!live?.send({ type: "control", action: "card_feedback", card_id: cardId, useful })) {
      throw new Error("Not connected to the meeting");
    }
  });
  handle(IPC.voiceList, () => backend!.listVoices());
  handle(IPC.voiceDelete, (id) => backend!.deleteVoice(String(id)));
  handle(IPC.voiceEnroll, async (name, consent) => {
    if (consent !== true) throw new Error("Tick the consent box first.");
    if (state.capturing || state.enrolling) throw new Error("Stop the current recording first.");
    const display = String(name ?? "").trim().slice(0, 100) || state.auth.email || "Me";
    state.enrolling = true;
    broadcast();
    try {
      // COPILOT_ENROLL_SECONDS shortens the sample for tests (the backend needs at least 10 s).
      const seconds = Math.max(10, Number(process.env.COPILOT_ENROLL_SECONDS) || ENROLL_SECONDS);
      const pcm = await recordMic(new RendererSource(captureHost!, "mic", getSettings().micDeviceId), seconds, (elapsed, level) =>
        sendToWindows(IPC.voiceProgress, { elapsed, level, total: seconds }),
      );
      return await backend!.enrollVoice(wavBytes(pcm), display, true);
    } finally {
      state.enrolling = false;
      broadcast();
    }
  });
  handle(IPC.ask, (q) => backend!.ask(String(q).slice(0, 1000)));
  const meetingId = (id: unknown) => {
    if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id)) throw new Error("Bad meeting id");
    return id;
  };
  const refresh = async (id: string) => {
    await syncMeeting(backend!, cache!, id);
    sendToWindows(IPC.state, state);
  };
  handle(IPC.meetingsRegenerate, async (id, template) => {
    const mid = meetingId(id);
    const info = await backend!.regenerate(mid, String(template));
    cache!.upsertExtras(mid, { summary: info });
    sendToWindows(IPC.state, state);
    void waitForSummary(backend!, cache!, mid).then(() => sendToWindows(IPC.state, state));
    return info;
  });
  handle(IPC.meetingsSaveSummary, async (id, data) => {
    const mid = meetingId(id);
    const info = await backend!.saveSummary(mid, data as never);
    await refresh(mid);
    return info;
  });
  handle(IPC.meetingsRenameSpeaker, async (id, label, name) => {
    const mid = meetingId(id);
    await backend!.renameSpeaker(mid, String(label), String(name).slice(0, 100));
    await refresh(mid);
  });
  handle(IPC.meetingsMarkdown, (id, withTranscript) => backend!.markdown(meetingId(id), withTranscript !== false));
  handle(IPC.meetingsExport, async (id) => {
    const mid = meetingId(id);
    const md = await backend!.markdown(mid, true);
    const title = cache!.getMeeting(mid)?.title ?? "meeting";
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Export meeting",
      defaultPath: `${title.replace(/[^\w .-]+/g, "_").slice(0, 80)}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (canceled || !filePath) return null;
    await writeFile(filePath, md, "utf8");
    return filePath;
  });
  handle(IPC.getSettings, () => getSettings());
  handle(IPC.setSettings, (patch) => {
    const next = updateSettings(patch);
    broadcast();
    return next;
  });
  handle(IPC.overlaySetExpanded, (expanded) => setExpanded(expanded === true));
  handle(IPC.overlayAction, (action, minutes) => {
    if (action !== "catch_up" && action !== "clarify" && action !== "follow_up") {
      throw new Error(`Unknown overlay action: ${String(action)}`);
    }
    return overlayAction(action, typeof minutes === "number" ? minutes : undefined);
  });
  handle(IPC.openMain, (route) => openMain(typeof route === "string" ? route : undefined));
  handle(IPC.secretSet, (name, value) => setSecret(name, value));
  handle(IPC.secretHas, (name) => hasSecret(name));
  handle(IPC.secretDelete, (name) => deleteSecret(name));
}

function registerHotkeys(): void {
  for (const hk of HOTKEYS) {
    const ok = globalShortcut.register(hk.accelerator, () => runHotkey(hk.command));
    if (!ok) console.warn(`[hotkeys] ${hk.accelerator} is taken by another app`);
  }
}

// ---------- lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => openMain());

  app.whenReady().then(() => {
    state.overlayExpanded = getSettings().overlayExpanded;
    hardenSessions();
    registerIpc();
    setupCapture();
    setupBackend();
    registerHotkeys();
    createTray();
    ensureMain();
    ensureOverlay();
  });

  app.on("before-quit", (e) => {
    quitting = true;
    // Finish the WAV files before exiting.
    if (capture?.isRunning) {
      e.preventDefault();
      void setCapturing(false).finally(() => app.quit());
    }
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    cache?.close();
  });
  // Tray app: stay running when windows close (except on explicit Quit).
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
  app.on("activate", () => openMain());
}
