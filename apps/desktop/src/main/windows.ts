import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { clampToWorkArea, defaultOverlayPosition, OVERLAY_SIZE } from "./geometry";

const preload = join(import.meta.dirname, "../preload/index.cjs");

const secureWebPreferences = {
  preload,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
} as const;

function load(win: BrowserWindow, page: "index.html" | "overlay.html", hash?: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(`${devUrl}/${page}${hash ? `#${hash}` : ""}`);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer", page), hash ? { hash } : undefined);
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: "Meeting Copilot",
    show: false,
    webPreferences: secureWebPreferences,
  });
  win.once("ready-to-show", () => win.show());
  load(win, "index.html");
  return win;
}

export function navigateMain(win: BrowserWindow, route: string): void {
  load(win, "index.html", route);
}

/**
 * The overlay floats above everything (including full-screen meeting apps) and is never
 * focusable, so typing in Teams or Zoom is never interrupted.
 */
export function createOverlayWindow(opts: {
  expanded: boolean;
  position: { x: number; y: number } | null;
}): BrowserWindow {
  const size = opts.expanded ? OVERLAY_SIZE.expanded : OVERLAY_SIZE.compact;
  const workArea = screen.getPrimaryDisplay().workArea;
  const pos = clampToWorkArea(
    opts.position ?? defaultOverlayPosition(workArea, opts.expanded),
    opts.expanded,
    workArea,
  );
  const win = new BrowserWindow({
    ...size,
    ...pos,
    title: "Meeting Copilot overlay",
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: "#111827",
    webPreferences: secureWebPreferences,
  });
  // "screen-saver" is the highest level; it keeps the overlay above full-screen windows.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  load(win, "overlay.html");
  return win;
}

export function resizeOverlay(win: BrowserWindow, expanded: boolean): void {
  const size = expanded ? OVERLAY_SIZE.expanded : OVERLAY_SIZE.compact;
  const [x, y] = win.getPosition();
  const display = screen.getDisplayNearestPoint({ x, y });
  const pos = clampToWorkArea({ x, y }, expanded, display.workArea);
  win.setBounds({ ...pos, ...size });
}
