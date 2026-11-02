// Contract between the main process and the renderers. Imported by main, preload and renderer.

export const IPC = {
  getState: "app:get-state",
  state: "app:state",
  toggleCapture: "capture:toggle",
  getSettings: "settings:get",
  setSettings: "settings:set",
  overlaySetExpanded: "overlay:set-expanded",
  overlayAction: "overlay:action",
  openMain: "window:open-main",
  secretSet: "secret:set",
  secretHas: "secret:has",
  secretDelete: "secret:delete",
  levels: "audio:levels",
  captureCommand: "capture:command",
  captureChunk: "capture:chunk",
  captureStatus: "capture:status",
} as const;

export type ChannelName = "mic" | "system";

export interface ChannelState {
  state: "off" | "starting" | "live" | "silent" | "unavailable" | "error";
  /** Which source is feeding the channel, e.g. "native-system" or "renderer-mic". */
  source?: string;
  message?: string;
}

export interface ChannelStatus {
  mic: ChannelState;
  system: ChannelState;
}

/** 0..1 meter values, sent about 10 times a second while capturing. */
export interface AudioLevels {
  mic: number;
  system: number;
}

/** Main -> hidden capture window. */
export type CaptureCommand =
  | { action: "start"; channel: ChannelName; deviceId?: string | null }
  | { action: "stop"; channel: ChannelName };

export type CaptureReport = { channel: ChannelName; state: "live" | "unavailable" | "error"; message?: string };

/** Buttons on the overlay. Stubs until the live-help prompts wire them up. */
export type OverlayAction = "catch_up" | "clarify" | "follow_up";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  theme: Theme;
  highContrast: boolean;
  captionFontSize: number;
  overlayExpanded: boolean;
  overlayPosition: { x: number; y: number } | null;
  backendUrl: string;
  /** Microphone deviceId, or null for the system default. */
  micDeviceId: string | null;
  /** Windows: capture only this app's audio (image name, e.g. "ms-teams.exe"); null = all. */
  systemAudioApp: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  highContrast: false,
  captionFontSize: 15,
  overlayExpanded: false,
  overlayPosition: null,
  backendUrl: "http://127.0.0.1:8000",
  micDeviceId: null,
  systemAudioApp: null,
};

export const CAPTION_FONT_RANGE = { min: 11, max: 28 } as const;

export interface AppState {
  capturing: boolean;
  /** Unix ms when capture started, or null. */
  captureStartedAt: number | null;
  overlayExpanded: boolean;
  /** Last overlay action pressed, for the stub UI. */
  lastAction: { action: OverlayAction; at: number } | null;
  audio: ChannelStatus;
}

/** Secret names the renderer may store. Values never come back to the renderer. */
export type SecretName = "backendToken" | "supabaseSession";
export const SECRET_NAMES: readonly SecretName[] = ["backendToken", "supabaseSession"];

/** What preload exposes as `window.copilot`. */
export interface CopilotApi {
  getState(): Promise<AppState>;
  onState(listener: (state: AppState) => void): () => void;
  toggleCapture(): Promise<AppState>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  overlay: {
    setExpanded(expanded: boolean): Promise<AppState>;
    action(action: OverlayAction): Promise<AppState>;
  };
  onLevels(listener: (levels: AudioLevels) => void): () => void;
  openMain(route?: string): Promise<void>;
  secrets: {
    set(name: SecretName, value: string): Promise<void>;
    has(name: SecretName): Promise<boolean>;
    delete(name: SecretName): Promise<void>;
  };
  /** Used only by the hidden capture window; main ignores these from any other window. */
  capture: {
    onCommand(listener: (cmd: CaptureCommand) => void): () => void;
    chunk(channel: ChannelName, samples: Float32Array, sampleRate: number): void;
    report(report: CaptureReport): void;
  };
}

export const ROUTES = {
  home: "/",
  start: "/start",
  meeting: "/meetings/:id",
  ask: "/ask",
  standup: "/standup",
  projects: "/projects",
  settings: "/settings",
  systemAudioHelp: "/help/system-audio",
} as const;

/** Allowed values for openMain(route): a fixed route or a meeting detail path. */
export function isAllowedRoute(route: string): boolean {
  if (Object.values(ROUTES).includes(route as never) && !route.includes(":")) return true;
  return /^\/meetings\/[\w-]{1,64}$/.test(route);
}
