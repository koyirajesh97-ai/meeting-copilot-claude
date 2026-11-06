// The browser's version of the desktop main process: implements `window.copilot` (CopilotApi)
// against the same backend, so the desktop screens run unchanged in a browser. Differences:
// - audio comes from the browser (mic + a shared tab or screen, see recorder.ts);
// - nothing is cached or recorded on this device; meetings are read from the backend;
// - settings live in localStorage, and so does the short-lived backend token (no API keys).

import { DEFAULT_CONSENT_MESSAGE } from "@meeting-copilot/shared/meetings";
import { Emitter, HOSTED_SUPABASE, OutboundAudio, type MeetingEvent } from "@meeting-copilot/shared";
import { AuthManager, SIGNED_OUT, type SecretBox } from "@desktop/main/backend/auth";
import { BackendClient, BackendError, type MeetingDetailOut, type MeetingOut } from "@desktop/main/backend/client";
import { integrationCall } from "@desktop/main/backend/integrations";
import { LiveConnection } from "@desktop/main/backend/live";
import { WatchConnection } from "@desktop/main/backend/watch";
import { projectCall } from "@desktop/main/backend/projects";
import { liveConnectionAllowed, sanitizeStartOptions } from "@desktop/main/startOptions";
import {
  DEFAULT_SETTINGS,
  DELETE_ACCOUNT_PHRASE,
  ENROLL_SECONDS,
  isAllowedRoute,
  type AppState,
  type AudioCheck,
  type AudioLevels,
  type CachedMeeting,
  type CachedMeetingDetail,
  type CopilotApi,
  type OverlayAction,
  type PrivacySettings,
  type ProjectCall,
  type ProviderInfo,
  type Settings,
  type SetupCall,
  type StartOptions,
  type SummaryInfo,
} from "@desktop/shared/ipc";
import { recordMicSamples, WebRecorder, wavFromFloat } from "./recorder";

/** Values baked in at build time (Vercel environment variables). */
export const BUILD = {
  backendUrl: (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") ?? "",
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) || HOSTED_SUPABASE.url,
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || HOSTED_SUPABASE.publishableKey,
};

const SETTINGS_KEY = "meeting-copilot.settings";
const SECRET_PREFIX = "meeting-copilot.secret.";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage: the app still works for this tab
  }
}

/** Saved settings over the defaults; build-time server values fill anything left empty. */
export function loadSettings(store: Storage | null = storage()): Settings {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(store?.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
  } catch {
    saved = {};
  }
  const s: Settings = { ...DEFAULT_SETTINGS, backendUrl: "", supabaseUrl: "", supabaseAnonKey: "", ...saved };
  return {
    ...s,
    backendUrl: s.backendUrl || BUILD.backendUrl,
    supabaseUrl: s.supabaseUrl || BUILD.supabaseUrl,
    supabaseAnonKey: s.supabaseAnonKey || BUILD.supabaseAnonKey,
  };
}

export function saveSettings(patch: Partial<Settings>, store: Storage | null = storage()): Settings {
  const next = { ...loadSettings(store), ...patch };
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: keep it for this tab */
  }
  return next;
}

export const localSecrets = (store: Storage | null = storage()): SecretBox => ({
  get: (name) => store?.getItem(SECRET_PREFIX + name) ?? null,
  set: (name, value) => store?.setItem(SECRET_PREFIX + name, value),
  delete: (name) => store?.removeItem(SECRET_PREFIX + name),
});

/** Backend meeting rows in the shape the screens use (they were built on the desktop cache). */
export function toCached(m: MeetingOut, segments = 0): CachedMeeting {
  return {
    id: m.id,
    title: m.title,
    type: m.type,
    mode: m.mode,
    started_at: m.started_at,
    ended_at: m.ended_at,
    segment_count: segments,
    is_mine: m.is_mine ?? true,
    is_live: m.is_live ?? false,
    visibility: m.visibility,
    project_id: m.project_id ?? null,
  };
}

export function toCachedDetail(m: MeetingDetailOut): CachedMeetingDetail {
  return {
    ...toCached(m, m.transcript.length),
    transcript: m.transcript,
    summary: m.summary,
    action_items: m.action_items,
    decisions: m.decisions,
    speaker_names: m.speaker_names ?? {},
  };
}

const MEETING_ID = /^[\w-]{1,64}$/;
const meetingId = (id: unknown): string => {
  if (typeof id !== "string" || !MEETING_ID.test(id)) throw new Error("Bad meeting id");
  return id;
};

/** Save a file to the browser's downloads. */
function download(name: string, data: Blob): string {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `${name} (your Downloads folder)`;
}

/** Ask the user for a file (Projects → Upload file…). Null if they close the picker. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

const AUDIO_CHECK_MS = 5000;
const SUMMARY_POLL_MS = 3000;
const SUMMARY_WAIT_MS = 3 * 60_000;

export function createWebApi(): CopilotApi {
  let settings = loadSettings();
  const backendUrl = () => settings.backendUrl;
  const auth = new AuthManager(new BackendClient(backendUrl, async () => null), () => settings, localSecrets());
  const backend = new BackendClient(backendUrl, () => auth.token());
  const outbound = new OutboundAudio();
  const live = new LiveConnection({ backend, outbound });
  const watcher = new WatchConnection(backend);

  const events = new Emitter<{ state: [AppState]; live: [MeetingEvent]; levels: [AudioLevels]; watch: [MeetingEvent]; voice: [{ elapsed: number; level: number; total: number }] }>();
  const state: AppState = {
    capturing: false,
    captureStartedAt: null,
    overlayExpanded: settings.overlayExpanded,
    lastAction: null,
    audio: { mic: { state: "off" }, system: { state: "off" } },
    enrolling: false,
    auth: auth.state,
    live: { status: "off", meetingId: null },
    paused: false,
    meetingMode: null,
    nudge: null,
  };
  const broadcast = () => events.emit("state", { ...state });
  type Events = typeof events extends Emitter<infer E> ? E : never;
  const sub = <K extends keyof Events>(event: K, fn: (...args: Events[K]) => void) => {
    events.on(event, fn);
    return () => void events.off(event, fn);
  };
  const recorder = new WebRecorder(outbound, {
    status: (s) => {
      state.audio = s;
      broadcast();
    },
    levels: (l) => events.emit("levels", l),
  });

  auth.on("change", (s) => {
    state.auth = s;
    broadcast();
  });
  live.on("state", (s) => {
    state.live = s;
    broadcast();
  });
  let pendingAnnounce: number | null = null;
  live.on("meeting", (id) => {
    if (pendingAnnounce && Date.now() - pendingAnnounce < 15 * 60_000) void logAnnounce(id);
    pendingAnnounce = null;
  });
  live.on("event", (e) => events.emit("live", e));
  watcher.on("event", (e) => events.emit("watch", e));
  watcher.on("closed", (message) =>
    events.emit("watch", { type: "error", seq: 0, meeting_id: "", ts_ms: Date.now(), code: "watch_closed", message, retryable: false } as MeetingEvent),
  );

  async function logAnnounce(id: string): Promise<boolean> {
    try {
      return (await backend.call<{ logged: boolean }>("POST", `/meetings/${encodeURIComponent(id)}/consent`, { kind: "announced" })).logged;
    } catch {
      return false;
    }
  }

  /** After a meeting ends, refresh the screens until its summary is ready (or gives up). */
  async function waitForSummary(id: string): Promise<void> {
    const until = Date.now() + SUMMARY_WAIT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, SUMMARY_POLL_MS));
      let info: SummaryInfo;
      try {
        info = await backend.getSummary(id);
      } catch {
        continue;
      }
      if (info.status !== "pending") {
        broadcast();
        return;
      }
    }
  }

  let captureOp: Promise<unknown> = Promise.resolve();
  function setCapturing(on: boolean, options?: StartOptions): Promise<AppState> {
    const op = captureOp.then(async () => {
      if (state.capturing === on) return state;
      if (on) {
        const opts = sanitizeStartOptions(options);
        // The indicator turns on before any audio is read.
        Object.assign(state, { capturing: true, paused: false, meetingMode: opts.mode, captureStartedAt: Date.now() });
        broadcast();
        await recorder.start({ micDeviceId: settings.micDeviceId, meetingAudio: true });
        const allowed = liveConnectionAllowed(opts.mode, settings.backendUrl);
        if (!allowed.ok) {
          // The browser keeps no recording, so a local-only meeting here only shows the meters.
          recorder.sendEnabled = false;
          state.live = { status: "local-only", meetingId: null, message: "Local-only in a browser keeps nothing. Use the desktop app to record to your computer." };
          broadcast();
        } else if (auth.state.signedIn) {
          void live.start(opts);
        } else {
          recorder.sendEnabled = false;
          state.live = { status: "local-only", meetingId: null, message: "Sign in (Settings) to get live captions." };
          broadcast();
        }
      } else {
        await recorder.stop();
        const id = await live.stop();
        outbound.clear();
        recorder.sendEnabled = true;
        const mode = state.meetingMode;
        Object.assign(state, { capturing: false, paused: false, meetingMode: null, captureStartedAt: null, live: { status: "off", meetingId: null } });
        broadcast();
        if (id && mode !== "live-only") void waitForSummary(id);
      }
      return state;
    });
    captureOp = op.catch(() => undefined);
    return op;
  }

  function setPaused(paused: boolean): AppState {
    if (!state.capturing || state.paused === paused) return state;
    recorder.paused = paused;
    live.send({ type: "control", action: paused ? "pause" : "resume" });
    state.paused = paused;
    broadcast();
    return state;
  }

  async function audioCheck(): Promise<AudioCheck> {
    if (state.capturing) throw new Error("Stop recording first");
    const peak = { mic: 0, system: 0 };
    const off = sub("levels", (l) => {
      peak.mic = Math.max(peak.mic, l.mic);
      peak.system = Math.max(peak.system, l.system);
    });
    Object.assign(state, { capturing: true, captureStartedAt: Date.now(), meetingMode: "live-only" });
    broadcast();
    try {
      recorder.sendEnabled = false; // the check's audio is never sent anywhere
      await recorder.start({ micDeviceId: settings.micDeviceId, meetingAudio: true });
      await new Promise((r) => setTimeout(r, AUDIO_CHECK_MS));
      const s = recorder.currentStatus;
      return { mic: { ...s.mic, peak: peak.mic }, system: { ...s.system, peak: peak.system } };
    } finally {
      await recorder.stop();
      recorder.sendEnabled = true;
      outbound.clear();
      off();
      Object.assign(state, { capturing: false, captureStartedAt: null, meetingMode: null });
      broadcast();
    }
  }

  function overlayAction(action: OverlayAction, minutes?: number): AppState {
    const sent = live.send({ type: "control", action, ...(action === "catch_up" ? { minutes: minutes === 5 ? 5 : 2 } : {}) });
    state.lastAction = sent ? null : { action, at: Date.now() };
    broadcast();
    return state;
  }

  const projects = (call: ProjectCall) =>
    projectCall(backend, call, async () => {
      const file = await pickFile(".md,.txt,.html,.htm,.pdf,.csv,.json,.yaml,.yml");
      return file ? { data: file, name: file.name } : null;
    });

  async function downloadFromBackend(path: string): Promise<Blob> {
    const t = await auth.token();
    if (!t) throw new BackendError("Not signed in", 401);
    const res = await fetch(`${backendUrl()}${path}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new BackendError(`Download failed: ${res.status}`, res.status);
    return res.blob();
  }

  const signedIn = () => {
    if (!auth.state.signedIn) throw new Error("Sign in first (Settings).");
  };

  return {
    getState: async () => ({ ...state }),
    onState: (l) => sub("state", l),
    toggleCapture: () => setCapturing(!state.capturing),
    startMeeting: (opts) => setCapturing(true, opts),
    onLive: (l) => sub("live", l),
    auth: {
      sendCode: (email) => auth.sendCode(String(email)),
      verifyCode: (email, code) => auth.verifyCode(String(email), String(code)),
      devAvailable: () => (settings.backendUrl ? auth.devAvailable() : Promise.resolve(false)),
      devSignIn: () => auth.devSignIn(),
      signOut: async () => {
        await auth.signOut();
        return SIGNED_OUT;
      },
    },
    voice: {
      async enroll(name, consent) {
        if (consent !== true) throw new Error("Tick the consent box first.");
        if (state.capturing || state.enrolling) throw new Error("Stop the current recording first.");
        signedIn();
        const display = String(name ?? "").trim().slice(0, 100) || state.auth.email || "Me";
        state.enrolling = true;
        broadcast();
        try {
          const { samples, rate } = await recordMicSamples(settings.micDeviceId, ENROLL_SECONDS, (elapsed, level) =>
            events.emit("voice", { elapsed, level, total: ENROLL_SECONDS }),
          );
          const form = new FormData();
          form.set("consent", "true");
          form.set("display_name", display);
          form.set("audio", wavFromFloat(samples, rate), "voice.wav");
          return await backend.upload("/speakers/enroll", form);
        } finally {
          state.enrolling = false;
          broadcast();
        }
      },
      list: () => backend.listVoices(),
      delete: (id) => backend.deleteVoice(String(id)),
      onProgress: (l) => sub("voice", l),
    },
    profile: {
      get: () => backend.getProfile(),
      put: (p) => backend.putProfile(p),
      presets: () => backend.profilePresets(),
    },
    async cardFeedback(cardId, useful) {
      if (!live.send({ type: "control", action: "card_feedback", card_id: cardId, useful })) throw new Error("Not connected to the meeting");
    },
    standup: {
      generate: (notes) => backend.standup(String(notes).slice(0, 4000)),
      today: () => backend.standupToday(),
      save: (edit) => backend.saveStandup(edit),
    },
    brief: (title, type, agenda) => backend.brief(String(title), String(type), String(agenda ?? "")),
    async setup<T>(call: SetupCall): Promise<T> {
      if (call.op === "audioCheck") return (await audioCheck()) as T;
      if (call.op === "providers") return backend.call<T>("GET", "/setup/providers");
      if (call.op === "saveKey") {
        // The key goes to the backend once; the web app never stores it.
        return backend.call<T>("POST", "/setup/keys", { provider: String(call.provider).slice(0, 50), key: String(call.key).trim().slice(0, 500) });
      }
      throw new Error("Unknown setup call");
    },
    integrations: <T>(call: Parameters<CopilotApi["integrations"]>[0]) =>
      integrationCall(backend, call, async (url) => {
        window.open(url, "_blank", "noopener");
      }) as Promise<T>,
    privacy: {
      async get() {
        const defaults: PrivacySettings = { allow_test_providers: false, retention_days: null, consent_message: DEFAULT_CONSENT_MESSAGE };
        if (!auth.state.signedIn) return { settings: defaults, providers: [], signedIn: false };
        const [s, providers] = await Promise.all([backend.call<PrivacySettings>("GET", "/me/privacy"), backend.call<ProviderInfo[]>("GET", "/providers")]);
        return { settings: s, providers, signedIn: true };
      },
      save: (p) =>
        backend.call("PUT", "/me/privacy", {
          allow_test_providers: p.allow_test_providers === true,
          retention_days: typeof p.retention_days === "number" ? Math.round(p.retention_days) : null,
          consent_message: String(p.consent_message ?? DEFAULT_CONSENT_MESSAGE).slice(0, 1000),
        }),
      async announce(message) {
        await navigator.clipboard?.writeText(String(message || DEFAULT_CONSENT_MESSAGE).slice(0, 1000)).catch(() => undefined);
        const id = live.currentMeetingId;
        if (id) return { logged: await logAnnounce(id) };
        pendingAnnounce = Date.now();
        return { logged: false };
      },
      pause: async () => setPaused(true),
      resume: async () => setPaused(false),
      async deleteMeeting(id) {
        try {
          await backend.call("DELETE", `/meetings/${encodeURIComponent(meetingId(id))}`);
        } catch (err) {
          if (!(err instanceof BackendError) || err.status !== 404) throw err;
        }
        broadcast();
      },
      exportAccount: async () => download("meeting-copilot-export.zip", await downloadFromBackend("/me/export")),
      async deleteAccount(phrase) {
        if (phrase !== DELETE_ACCOUNT_PHRASE) throw new Error(`Type "${DELETE_ACCOUNT_PHRASE}" to confirm`);
        if (state.capturing) throw new Error("Stop recording first");
        await backend.call("POST", "/me/delete", { confirm: DELETE_ACCOUNT_PHRASE });
        await auth.signOut();
        broadcast();
      },
    },
    projects: <T>(call: ProjectCall) => projects(call) as Promise<T>,
    async editMeeting(id, patch) {
      const p = (patch ?? {}) as Record<string, unknown>;
      const clean = Object.fromEntries(["title", "type", "visibility", "project_id"].filter((k) => typeof p[k] === "string").map((k) => [k, p[k]]));
      await backend.editMeeting(meetingId(id), clean);
      broadcast();
    },
    watch: {
      start: (id) => watcher.start(meetingId(id)),
      stop: async () => watcher.stop(),
      onEvent: (l) => sub("watch", l),
    },
    search: (q) => backend.search(String(q).slice(0, 500)),
    ask: (q) => backend.ask(String(q).slice(0, 1000)),
    meetings: {
      list: async () => (auth.state.signedIn ? (await backend.listMeetings()).map((m) => toCached(m)) : []),
      async get(id) {
        if (!auth.state.signedIn) return null;
        try {
          return toCachedDetail(await backend.getMeeting(meetingId(id)));
        } catch (err) {
          if (err instanceof BackendError && err.status === 404) return null;
          throw err;
        }
      },
      async sync() {
        if (!auth.state.signedIn) return { meetings: 0 };
        try {
          const n = (await backend.listMeetings()).length;
          broadcast();
          return { meetings: n };
        } catch (err) {
          return { meetings: 0, error: (err as Error).message };
        }
      },
      async regenerate(id, template) {
        const mid = meetingId(id);
        const info = await backend.regenerate(mid, String(template));
        void waitForSummary(mid);
        return info;
      },
      async saveSummary(id, data) {
        const info = await backend.saveSummary(meetingId(id), data);
        broadcast();
        return info;
      },
      async renameSpeaker(id, label, name) {
        await backend.renameSpeaker(meetingId(id), String(label), String(name).slice(0, 100));
        broadcast();
      },
      markdown: (id, withTranscript) => backend.markdown(meetingId(id), withTranscript !== false),
      async exportMarkdown(id) {
        const mid = meetingId(id);
        const [md, m] = await Promise.all([backend.markdown(mid, true), backend.getMeeting(mid).catch(() => null)]);
        const title = (m?.title ?? "meeting").replace(/[^\w .-]+/g, "_").slice(0, 80);
        return download(`${title}.md`, new Blob([md], { type: "text/markdown" }));
      },
    },
    getSettings: async () => settings,
    async setSettings(patch) {
      const before = settings.backendUrl;
      settings = saveSettings(patch);
      if ("overlayExpanded" in patch) state.overlayExpanded = settings.overlayExpanded;
      broadcast();
      // A different server means a different account; start over against it.
      if (settings.backendUrl !== before) location.reload();
      return settings;
    },
    overlay: {
      async setExpanded(expanded) {
        state.overlayExpanded = expanded === true;
        settings = saveSettings({ overlayExpanded: state.overlayExpanded });
        broadcast();
        return state;
      },
      action: async (action, minutes) => overlayAction(action, minutes),
    },
    onLevels: (l) => sub("levels", l),
    async openMain(route) {
      if (route && isAllowedRoute(route)) location.hash = `#${route}`;
      window.focus();
    },
    // The renderer never needs these in the browser; kept so the interface is complete.
    secrets: {
      set: async () => undefined,
      has: async () => false,
      delete: async () => undefined,
    },
    capture: {
      onCommand: () => () => undefined,
      chunk: () => undefined,
      report: () => undefined,
    },
  };
}
