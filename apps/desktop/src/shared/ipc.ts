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
} as const;

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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  highContrast: false,
  captionFontSize: 15,
  overlayExpanded: false,
  overlayPosition: null,
  backendUrl: "http://127.0.0.1:8000",
};

export const CAPTION_FONT_RANGE = { min: 11, max: 28 } as const;

export interface AppState {
  capturing: boolean;
  /** Unix ms when capture started, or null. */
  captureStartedAt: number | null;
  overlayExpanded: boolean;
  /** Last overlay action pressed, for the stub UI. */
  lastAction: { action: OverlayAction; at: number } | null;
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
  openMain(route?: string): Promise<void>;
  secrets: {
    set(name: SecretName, value: string): Promise<void>;
    has(name: SecretName): Promise<boolean>;
    delete(name: SecretName): Promise<void>;
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
} as const;

/** Allowed values for openMain(route): a fixed route or a meeting detail path. */
export function isAllowedRoute(route: string): boolean {
  if (Object.values(ROUTES).includes(route as never) && !route.includes(":")) return true;
  return /^\/meetings\/[\w-]{1,64}$/.test(route);
}
