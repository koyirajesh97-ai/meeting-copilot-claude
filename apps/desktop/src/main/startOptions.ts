import type { StartOptions } from "../shared/ipc";
import { MEETING_TYPES } from "../shared/meetings";

const TYPES = new Set<string>(MEETING_TYPES.map((t) => t.id));
const MODES = new Set(["cloud", "local", "live-only"]);

export function defaultStartOptions(now = new Date()): StartOptions {
  const when = now.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return { title: `Meeting, ${when}`, type: "custom", mode: "cloud", visibility: "private", agenda: "", project_id: null, calendar_event_id: null };
}

/** Validate what a renderer sends; fall back to defaults for anything missing or invalid. */
export function sanitizeStartOptions(raw: unknown, now = new Date()): StartOptions {
  const d = defaultStartOptions(now);
  if (typeof raw !== "object" || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim().slice(0, 200) : "";
  const project_id = typeof r.project_id === "string" && /^[\w-]{1,64}$/.test(r.project_id) ? r.project_id : null;
  return {
    title: title || d.title,
    type: typeof r.type === "string" && TYPES.has(r.type) ? r.type : d.type,
    mode: typeof r.mode === "string" && MODES.has(r.mode) ? (r.mode as StartOptions["mode"]) : d.mode,
    // Sharing needs a project; the backend also checks you're a member who may share.
    visibility: project_id && r.visibility === "project" ? "project" : "private",
    agenda: typeof r.agenda === "string" ? r.agenda.slice(0, 4000) : "",
    project_id,
    calendar_event_id: typeof r.calendar_event_id === "string" && r.calendar_event_id.length <= 1024 ? r.calendar_event_id : null,
  };
}

/** True for http(s)://localhost, 127.x.x.x or [::1]. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}

/**
 * Whether this meeting may talk to the backend. Local-only meetings only connect to a backend
 * on this computer; otherwise they record to this computer only.
 */
export function liveConnectionAllowed(mode: StartOptions["mode"], backendUrl: string): { ok: true } | { ok: false; message: string } {
  if (mode === "local" && !isLoopbackUrl(backendUrl)) {
    return { ok: false, message: "Local-only: the backend isn't on this computer, so this records to your computer only." };
  }
  return { ok: true };
}
