// Contract between the main process and the renderers. Imported by main, preload and renderer.
import type { MeetingEvent } from "@meeting-copilot/shared";

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
  startMeeting: "meeting:start",
  liveEvent: "live:event",
  authStatus: "auth:status",
  authSendCode: "auth:send-code",
  authVerifyCode: "auth:verify-code",
  authDevSignIn: "auth:dev-sign-in",
  authDevAvailable: "auth:dev-available",
  authSignOut: "auth:sign-out",
  meetingsList: "meetings:list",
  meetingsGet: "meetings:get",
  meetingsSync: "meetings:sync",
  meetingsRegenerate: "meetings:regenerate",
  meetingsSaveSummary: "meetings:save-summary",
  meetingsRenameSpeaker: "meetings:rename-speaker",
  meetingsMarkdown: "meetings:markdown",
  meetingsExport: "meetings:export",
  voiceEnroll: "voice:enroll",
  voiceList: "voice:list",
  voiceDelete: "voice:delete",
  voiceProgress: "voice:progress",
  profileGet: "profile:get",
  profilePut: "profile:put",
  profilePresets: "profile:presets",
  cardFeedback: "card:feedback",
  standupGenerate: "standup:generate",
  standupToday: "standup:today",
  standupSave: "standup:save",
  brief: "meeting:brief",
  search: "search:query",
  ask: "search:ask",
} as const;

export interface SearchHit {
  meeting_id: string;
  title: string;
  started_at: number;
  source_type: "transcript" | "summary" | string;
  text: string;
  start_ms: number | null;
  score: number;
}

export interface AskAnswer {
  answer: string;
  found: boolean;
  citations: { id: string; meeting_id: string; title: string; start_ms: number | null; quote: string }[];
  provider: string | null;
}

export interface RoleProfile {
  name: string;
  aliases: string[];
  title: string;
  responsibilities: string;
  systems_owned: string[];
  current_tickets: string[];
  speaking_style: string;
}

export interface StandupEntry {
  id: string;
  date: string;
  project_id: string | null;
  notes: string;
  done: string[];
  doing: string[];
  blockers: string[];
  script: string;
}

export interface Brief {
  open_action_items: { id: string; text: string; owner: string | null; due: string | null; meeting_id: string; meeting_title: string }[];
  last_meeting: { id: string; title: string; started_at: number } | null;
  last_decisions: string[];
  last_blockers: string[];
  last_open_questions: string[];
  agenda: string;
}

export interface EnrolledVoice {
  id: string;
  display_name: string;
  project_id: string | null;
  consent_at: number;
}

export const ENROLL_SECONDS = 30;

/** The consent text shown before recording; the checkbox must be ticked to continue. */
export const VOICE_CONSENT_TEXT =
  "A voiceprint is biometric data: a numeric summary of how your voice sounds. Meeting Copilot " +
  "uses it only to label you by name in meetings of your projects. It's made from the recording " +
  "you make now, stored encrypted, never shared, and you can delete it at any time. The recording " +
  "itself is not kept.";

/** Route that opens a meeting, optionally at a moment (for citations). */
export function meetingRoute(id: string, startMs?: number | null): string {
  return startMs === null || startMs === undefined ? `/meetings/${id}` : `/meetings/${id}?t=${Math.max(0, Math.round(startMs))}`;
}

// ---------- summaries (mirrors services/backend/app/summaries/schema.py) ----------

export interface SummaryActionItem {
  owner: string | null;
  text: string;
  due_date: string | null;
}

export interface SummaryData {
  overview: string;
  sections: { key: string; title: string; items: string[] }[];
  decisions: { text: string; rationale: string }[];
  takeaways: string[];
  action_items: SummaryActionItem[];
  blockers: string[];
  open_questions: string[];
  per_person: { person: string; done: string[]; doing: string[]; blockers: string[] }[];
}

export interface SummaryInfo {
  status: "none" | "pending" | "ready" | "failed";
  error: string | null;
  id: string | null;
  template: string | null;
  data: SummaryData | null;
}

export interface ActionItem {
  id: string;
  text: string;
  owner: string | null;
  due: string | null;
  status: string;
  source: string;
  /** "I'll follow up" items: the question, who asked, and the reply drafted after the meeting. */
  question?: string | null;
  asker?: string | null;
  draft?: string | null;
}

export interface AuthState {
  signedIn: boolean;
  email: string | null;
  /** "supabase" for a real account, "dev" for the local dev login. */
  kind: "supabase" | "dev" | null;
}

export interface LiveState {
  /** off: not recording. connecting/reconnecting: audio is buffered locally meanwhile. */
  status: "off" | "connecting" | "live" | "reconnecting" | "local-only";
  meetingId: string | null;
  message?: string;
}

export interface StartOptions {
  title: string;
  type: string;
  mode: "cloud" | "local" | "live-only";
  visibility: "private" | "project";
  agenda?: string;
}

export interface CachedSegment {
  segment_id: string;
  channel: "mic" | "system";
  speaker_id: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface CachedMeeting {
  id: string;
  title: string;
  type: string;
  mode: string;
  started_at: number;
  ended_at: number | null;
  segment_count: number;
}

export interface CachedMeetingDetail extends CachedMeeting {
  transcript: CachedSegment[];
  summary: SummaryInfo;
  action_items: ActionItem[];
  decisions: { id: string; text: string; rationale: string }[];
  speaker_names: Record<string, string>;
}

/** Display name for a transcript speaker id: "me" is You; "spk_1" is Speaker 2 unless renamed. */
export function speakerLabel(id: string, names: Record<string, string> = {}): string {
  if (names[id]) return names[id];
  if (id === "me") return "You";
  const m = /^spk_(\d+)$/.exec(id);
  return m ? `Speaker ${Number(m[1]) + 1}` : id;
}

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
  /** Supabase project URL and its public anon key (safe to ship; RLS protects data). */
  supabaseUrl: string;
  supabaseAnonKey: string;
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
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseAnonKey: "",
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
  /** True while recording a voice sample for enrollment (the indicator shows it). */
  enrolling: boolean;
  auth: AuthState;
  live: LiveState;
}

/** Secret names the renderer may store. Values never come back to the renderer. */
export type SecretName = "backendToken" | "supabaseSession";
export const SECRET_NAMES: readonly SecretName[] = ["backendToken", "supabaseSession"];

/** What preload exposes as `window.copilot`. */
export interface CopilotApi {
  getState(): Promise<AppState>;
  onState(listener: (state: AppState) => void): () => void;
  toggleCapture(): Promise<AppState>;
  startMeeting(opts: StartOptions): Promise<AppState>;
  /** Live meeting events from the backend (captions, provider switches, errors). */
  onLive(listener: (event: MeetingEvent) => void): () => void;
  auth: {
    sendCode(email: string): Promise<void>;
    verifyCode(email: string, code: string): Promise<AuthState>;
    devAvailable(): Promise<boolean>;
    devSignIn(): Promise<AuthState>;
    signOut(): Promise<AuthState>;
  };
  voice: {
    /** Record ENROLL_SECONDS of mic audio and enroll it. `consent` must be true. */
    enroll(displayName: string, consent: boolean): Promise<EnrolledVoice>;
    list(): Promise<EnrolledVoice[]>;
    delete(id: string): Promise<void>;
    onProgress(listener: (p: { elapsed: number; level: number; total: number }) => void): () => void;
  };
  profile: {
    get(): Promise<RoleProfile>;
    put(p: RoleProfile): Promise<RoleProfile>;
    presets(): Promise<Record<string, RoleProfile>>;
  };
  /** Used / Not useful on a live card. */
  cardFeedback(cardId: string, useful: boolean): Promise<void>;
  standup: {
    /** Rough notes in; done / doing / blockers and a 30-second script out (saved for today). */
    generate(notes: string): Promise<StandupEntry>;
    today(): Promise<StandupEntry | null>;
    save(edit: Pick<StandupEntry, "done" | "doing" | "blockers" | "script">): Promise<StandupEntry>;
  };
  /** Pre-meeting brief for a meeting about to start. */
  brief(title: string, type: string, agenda: string): Promise<Brief>;
  /** Search all your meetings (backend; needs a connection). */
  search(query: string): Promise<SearchHit[]>;
  /** "Ask my meetings": a cited answer, or found: false when nothing relevant exists. */
  ask(question: string): Promise<AskAnswer>;
  meetings: {
    list(): Promise<CachedMeeting[]>;
    get(id: string): Promise<CachedMeetingDetail | null>;
    sync(): Promise<{ meetings: number; error?: string }>;
    regenerate(id: string, template: string): Promise<SummaryInfo>;
    saveSummary(id: string, data: SummaryData): Promise<SummaryInfo>;
    renameSpeaker(id: string, label: string, name: string): Promise<void>;
    /** Markdown of the meeting; withTranscript false gives a summary to paste into email or Teams. */
    markdown(id: string, withTranscript: boolean): Promise<string>;
    /** Save the Markdown to a file the user picks. Returns the path, or null if cancelled. */
    exportMarkdown(id: string): Promise<string | null>;
  };
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  overlay: {
    setExpanded(expanded: boolean): Promise<AppState>;
    /** minutes: Catch me up only, 2 (default) or 5 (long press). */
    action(action: OverlayAction, minutes?: number): Promise<AppState>;
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
  voice: "/voice",
  profile: "/profile",
} as const;

/** Allowed values for openMain(route): a fixed route or a meeting detail path. */
export function isAllowedRoute(route: string): boolean {
  if (Object.values(ROUTES).includes(route as never) && !route.includes(":")) return true;
  return /^\/meetings\/[\w-]{1,64}(\?t=\d{1,9})?$/.test(route);
}
