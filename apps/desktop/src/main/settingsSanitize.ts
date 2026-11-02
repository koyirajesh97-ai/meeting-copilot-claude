import { CAPTION_FONT_RANGE, DEFAULT_SETTINGS, type Settings } from "../shared/ipc";

const THEMES = new Set(["system", "light", "dark"]);

/** Merge a patch from the renderer into settings, dropping unknown keys and bad values. */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  const next: Settings = { ...current };
  if (typeof patch !== "object" || patch === null) return next;
  const p = patch as Record<string, unknown>;

  if (typeof p.theme === "string" && THEMES.has(p.theme)) next.theme = p.theme as Settings["theme"];
  if (typeof p.highContrast === "boolean") next.highContrast = p.highContrast;
  if (typeof p.overlayExpanded === "boolean") next.overlayExpanded = p.overlayExpanded;
  if (typeof p.captionFontSize === "number" && Number.isFinite(p.captionFontSize)) {
    next.captionFontSize = Math.round(
      Math.min(Math.max(p.captionFontSize, CAPTION_FONT_RANGE.min), CAPTION_FONT_RANGE.max),
    );
  }
  if (p.overlayPosition === null) next.overlayPosition = null;
  else if (isPoint(p.overlayPosition)) {
    next.overlayPosition = { x: Math.round(p.overlayPosition.x), y: Math.round(p.overlayPosition.y) };
  }
  if (typeof p.backendUrl === "string" && isHttpUrl(p.backendUrl)) next.backendUrl = p.backendUrl;
  if (typeof p.supabaseUrl === "string" && isHttpUrl(p.supabaseUrl)) next.supabaseUrl = p.supabaseUrl.replace(/\/+$/, "");
  if (typeof p.supabaseAnonKey === "string" && p.supabaseAnonKey.length <= 4096 && /^[\w.-]*$/.test(p.supabaseAnonKey)) {
    next.supabaseAnonKey = p.supabaseAnonKey;
  }
  if (p.micDeviceId === null || (typeof p.micDeviceId === "string" && p.micDeviceId.length <= 256)) {
    next.micDeviceId = p.micDeviceId || null;
  }
  if (p.systemAudioApp === null || p.systemAudioApp === "") next.systemAudioApp = null;
  else if (typeof p.systemAudioApp === "string" && /^[\w .-]{1,64}\.exe$/i.test(p.systemAudioApp.trim())) {
    next.systemAudioApp = p.systemAudioApp.trim();
  }
  return next;
}

/** Load stored settings, filling gaps with defaults. */
export function loadSettings(stored: unknown): Settings {
  return applySettingsPatch(DEFAULT_SETTINGS, stored);
}

function isPoint(v: unknown): v is { x: number; y: number } {
  if (typeof v !== "object" || v === null) return false;
  const { x, y } = v as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
