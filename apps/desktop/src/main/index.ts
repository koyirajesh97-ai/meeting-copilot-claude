import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  session,
  Tray,
  type IpcMainInvokeEvent,
  type WebFrameMain,
} from "electron";
import { IPC, isAllowedRoute, type AppState, type OverlayAction } from "../shared/ipc";
import { contentSecurityPolicy } from "./csp";
import { HOTKEYS, type HotkeyCommand } from "./hotkeys";
import { trayIcons } from "./icons";
import { deleteSecret, getSettings, hasSecret, setSecret, updateSettings } from "./store";
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
};

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

function setCapturing(on: boolean): AppState {
  if (state.capturing === on) return state;
  state.capturing = on;
  state.captureStartedAt = on ? Date.now() : null;
  // Audio capture itself arrives in Prompt 3; the indicator is driven by this flag.
  if (on) showOverlay();
  broadcast();
  return state;
}

function setExpanded(expanded: boolean): AppState {
  state.overlayExpanded = expanded;
  updateSettings({ overlayExpanded: expanded });
  if (overlayWindow && !overlayWindow.isDestroyed()) resizeOverlay(overlayWindow, expanded);
  broadcast();
  return state;
}

function overlayAction(action: OverlayAction): AppState {
  // Stub: the live-help prompts replace this with real requests to the backend.
  state.lastAction = { action, at: Date.now() };
  showOverlay();
  broadcast();
  return state;
}

function runHotkey(command: HotkeyCommand): void {
  switch (command) {
    case "toggle_capture":
      setCapturing(!state.capturing);
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
  tray.setImage(state.capturing ? trayIcons.recording() : trayIcons.idle());
  tray.setToolTip(state.capturing ? "Meeting Copilot — recording" : "Meeting Copilot");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: state.capturing ? "Stop recording" : "Start recording",
        accelerator: "CommandOrControl+Shift+R",
        click: () => setCapturing(!state.capturing),
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
  handle(IPC.getSettings, () => getSettings());
  handle(IPC.setSettings, (patch) => {
    const next = updateSettings(patch);
    broadcast();
    return next;
  });
  handle(IPC.overlaySetExpanded, (expanded) => setExpanded(expanded === true));
  handle(IPC.overlayAction, (action) => {
    if (action !== "catch_up" && action !== "clarify" && action !== "follow_up") {
      throw new Error(`Unknown overlay action: ${String(action)}`);
    }
    return overlayAction(action);
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
    registerHotkeys();
    createTray();
    ensureMain();
    ensureOverlay();
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  // Tray app: stay running when windows close (except on explicit Quit).
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
  app.on("activate", () => openMain());
}
