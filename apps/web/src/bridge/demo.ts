// Demo mode: the web app with sample meetings and a simulated meeting, used when the site has
// no backend configured (VITE_BACKEND_URL unset and none entered in Settings). Nothing is
// recorded or sent anywhere. Setting a backend URL in Settings switches to the real app.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import type { CopilotApi } from "@desktop/shared/ipc";
import { loadSettings, saveSettings } from "./web";

type Listener<T> = (v: T) => void;
const now = Date.now() / 1000;
const seg = (i: number, speaker: string, text: string, ch: "mic" | "system" = "system") => ({
  segment_id: `seg_${i}`, channel: speaker === "me" ? "mic" : ch, speaker_id: speaker, text, start_ms: i * 6000, end_ms: i * 6000 + 5000,
});

const standupSummary = {
  overview: "Quick standup on the payments cluster: the certificate renewal is done, the prod deploy moves to Thursday, and VPN access for staging is the one blocker.",
  sections: [],
  decisions: [{ text: "Move the prod deploy to Thursday", rationale: "after the cert renewal settles" }],
  takeaways: [],
  action_items: [],
  blockers: ["VPN access for staging (Sai)"],
  open_questions: [],
  per_person: [
    { person: "Sai", done: ["Renewed the payments cluster certificate (OPS-142)"], doing: ["Moving the prod deploy to Thursday"], blockers: ["VPN access for staging"] },
    { person: "Priya", done: ["Fixed the login tests"], doing: ["Retry PR ready for review this afternoon"], blockers: [] },
  ],
};
const reviewSummary = {
  overview: "Design review of the retry PR. Agreed on exponential backoff with a 5-minute cap; Alex adds queue metrics before merge.",
  sections: [{ key: "feedback", title: "Feedback", items: ["Cap retries at 5 minutes", "Log the final failure with the request id"] }],
  decisions: [{ text: "Exponential backoff, capped at 5 minutes", rationale: "" }],
  takeaways: [],
  action_items: [],
  blockers: [],
  open_questions: ["Do we need a dead-letter queue now or later?"],
  per_person: [],
};
const meetings: Record<string, any> = {
  m1: {
    id: "m1", title: "Payments daily standup", type: "standup", mode: "cloud", started_at: now - 3600 * 3, ended_at: now - 3600 * 3 + 900,
    segment_count: 5, is_mine: true, is_live: false, visibility: "private", project_id: null,
    transcript: [
      seg(0, "me", "Morning everyone, quick update from me."),
      seg(1, "me", "I finished the certificate renewal for the payments cluster yesterday."),
      seg(2, "me", "Today I'm moving the production deploy to Thursday."),
      seg(3, "me", "I'm blocked on VPN access for staging."),
      seg(4, "spk_0", "Thanks Sai. Priya here: the retry pull request is ready for review this afternoon."),
    ],
    summary: { status: "ready", error: null, id: "s1", template: "standup", data: standupSummary },
    action_items: [{ id: "a1", text: "Get VPN access for staging", owner: "Sai", due: "Friday", status: "open", source: "summary" }],
    decisions: [], speaker_names: { spk_0: "Priya" },
  },
  m2: {
    id: "m2", title: "Retry PR design review", type: "review", mode: "cloud", started_at: now - 86400, ended_at: now - 86400 + 1800,
    segment_count: 3, is_mine: true, is_live: false, visibility: "private", project_id: null,
    transcript: [seg(0, "spk_0", "Let's walk through the retry design."), seg(1, "me", "I'd cap the backoff at five minutes."), seg(2, "spk_1", "Agreed. I'll add queue metrics before we merge.")],
    summary: { status: "ready", error: null, id: "s2", template: "review", data: reviewSummary },
    action_items: [{ id: "a2", text: "Add retry queue metrics", owner: "Alex", due: "before merge", status: "open", source: "summary" }],
    decisions: [], speaker_names: { spk_0: "Priya", spk_1: "Alex" },
  },
};

let settings: any = { ...loadSettings(), setupDone: true };
const live = { status: "off", meetingId: null as string | null };
let state: any = {
  capturing: false, captureStartedAt: null, overlayExpanded: settings.overlayExpanded, lastAction: null,
  audio: { mic: { state: "off" }, system: { state: "off" } }, enrolling: false,
  auth: { signedIn: true, email: "demo@example.com", kind: "dev" }, live, paused: false, meetingMode: null, nudge: null,
};
const stateListeners = new Set<Listener<any>>();
const liveListeners = new Set<Listener<any>>();
const levelListeners = new Set<Listener<any>>();
const emit = () => stateListeners.forEach((l) => l(state));

// ---------- a simulated meeting: captions and a card, on a loop while "recording" ----------
const SCRIPT: [string, string][] = [
  ["me", "Morning everyone, let's start the standup."],
  ["spk_0", "Priya here: login tests are fixed, the retry PR is up for review."],
  ["me", "I finished the certificate renewal for the payments cluster."],
  ["spk_1", "Sai, when is the prod deploy happening?"],
  ["me", "We moved it to Thursday after the cert renewal."],
];
let seq = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let levelTimer: ReturnType<typeof setInterval> | null = null;
let liveId = "";
const send = (e: any) => liveListeners.forEach((l) => l({ seq: ++seq, meeting_id: liveId, ts_ms: Date.now(), ...e }));

function startDemo(title: string) {
  liveId = `live_${Date.now()}`;
  state = { ...state, capturing: true, captureStartedAt: Date.now(), meetingMode: "cloud",
    audio: { mic: { state: "live", source: "mic" }, system: { state: "live", source: "system" } },
    live: { status: "live", meetingId: liveId } };
  emit();
  send({ type: "meeting.started", mode: "cloud", providers: { "stt_live.system": "deepgram/nova-3", "stt_live.mic": "deepgram/nova-3" } });
  let i = 0;
  timer = setInterval(() => {
    const [who, text] = SCRIPT[i % SCRIPT.length];
    send({ type: "transcript.final", segment_id: `live_${i}`, channel: who === "me" ? "mic" : "system", speaker_id: who, text, start_ms: i * 3000, end_ms: i * 3000 + 2500 });
    if (i % SCRIPT.length === 3) {
      send({ type: "card.created", card_id: `card_${i}`, kind: "answer", confidence: 0.82, provider: "groq/openai/gpt-oss-20b",
        text: "• Prod deploy moved to Thursday, after the cert renewal\n• OPS-142 renewal finished yesterday",
        sources: [{ type: "meeting", id: "m1", start_ms: 12000, title: "Payments daily standup" }] });
    }
    i++;
  }, 2200);
  levelTimer = setInterval(() => levelListeners.forEach((l) => l({ mic: Math.random() * 0.6, system: Math.random() * 0.5 })), 120);
  (window as any).__demoTitle = title;
}

function stopDemo() {
  if (timer) clearInterval(timer);
  if (levelTimer) clearInterval(levelTimer);
  const id = `m${Object.keys(meetings).length + 1}`;
  meetings[id] = { ...meetings.m1, id, title: (window as any).__demoTitle || "Meeting, just now", started_at: Date.now() / 1000 - 60, ended_at: Date.now() / 1000 };
  state = { ...state, capturing: false, captureStartedAt: null, meetingMode: null, audio: { mic: { state: "off" }, system: { state: "off" } }, live: { status: "off", meetingId: null } };
  emit();
}

const list = () => Object.values(meetings).sort((a, b) => b.started_at - a.started_at).map(({ transcript, summary, action_items, decisions, speaker_names, ...m }) => m);
const ok = <T,>(v: T) => Promise.resolve(v);
const integrationsList = [
  { kind: "google", label: "Google Calendar", enabled: true, connected: true, config: {}, last_error: null, available: true },
  { kind: "microsoft", label: "Outlook / Microsoft 365", enabled: false, connected: false, config: {}, last_error: null, available: true },
  { kind: "jira", label: "Jira", enabled: false, connected: false, config: {}, last_error: null, available: true },
  { kind: "slack", label: "Slack", enabled: true, connected: true, config: {}, last_error: null, available: true },
  { kind: "teams", label: "Microsoft Teams", enabled: false, connected: false, config: {}, last_error: null, available: true },
];
const upcoming = [
  { id: "google:e1", source: "google", title: "Payments daily standup", start: now + 60 * 40, end: now + 60 * 55, attendees: 6, guessed_type: "standup", agenda: "1. Deploy plan\n2. Blockers", join_url: null, meeting_id: null },
  { id: "google:e2", source: "google", title: "Retry PR design review", start: now + 3600 * 3, end: now + 3600 * 4, attendees: 4, guessed_type: "review", agenda: "", join_url: null, meeting_id: null },
];
const profile = { name: "Sai", aliases: ["SK"], title: "DevOps/SRE", responsibilities: "Deployments, CI/CD, infrastructure, on-call.", systems_owned: ["payments cluster", "ArgoCD"], current_tickets: ["OPS-142"], speaking_style: "brief and direct" };

const api: any = {
  demo: true,
  getState: () => ok(state),
  onState: (l: Listener<any>) => (stateListeners.add(l), () => stateListeners.delete(l)),
  onLive: (l: Listener<any>) => (liveListeners.add(l), () => liveListeners.delete(l)),
  onLevels: (l: Listener<any>) => (levelListeners.add(l), () => levelListeners.delete(l)),
  getSettings: () => ok(settings),
  setSettings: (p: any) => {
    settings = { ...settings, ...p };
    if ("overlayExpanded" in p) {
      state = { ...state, overlayExpanded: !!p.overlayExpanded };
      emit();
    }
    // Pointing the site at a real backend leaves demo mode.
    if (typeof p.backendUrl === "string" && p.backendUrl.trim()) {
      saveSettings({ backendUrl: p.backendUrl.trim() });
      location.reload();
    }
    return ok(settings);
  },
  startMeeting: (o: any) => (startDemo(o?.title || "Meeting, just now"), ok(state)),
  toggleCapture: () => (state.capturing ? stopDemo() : startDemo("Meeting, just now"), ok(state)),
  openMain: (route?: string) => (route && (location.hash = `#${route}`), ok(undefined)),
  overlay: {
    setExpanded: (x: boolean) => ((state = { ...state, overlayExpanded: x }), emit(), ok(state)),
    action: (a: string) => {
      if (a === "catch_up") send({ type: "card.created", card_id: `c_${Date.now()}`, kind: "catch_up", confidence: 0.9, provider: "groq/openai/gpt-oss-20b",
        text: "Last 2 min:\n• Priya: retry PR is up for review\n• You: cert renewal done, deploy on Thursday", sources: [] });
      return ok(state);
    },
  },
  auth: { sendCode: () => ok(undefined), verifyCode: () => ok(state.auth), devAvailable: () => ok(false), devSignIn: () => ok(state.auth), signOut: () => ok(state.auth) },
  meetings: {
    list: () => ok(list()),
    get: (id: string) => ok(meetings[id] ?? null),
    sync: () => ok({ meetings: list().length }),
    regenerate: (id: string) => ok(meetings[id]?.summary),
    saveSummary: (id: string, data: any) => ((meetings[id].summary.data = data), ok(meetings[id].summary)),
    renameSpeaker: (id: string, label: string, name: string) => ((meetings[id].speaker_names[label] = name), emit(), ok(undefined)),
    markdown: (id: string) => ok(`# ${meetings[id]?.title}\n\n${meetings[id]?.summary.data?.overview ?? ""}`),
    exportMarkdown: () => ok(null),
  },
  search: (q: string) => ok(Object.values(meetings).flatMap((m: any) => m.transcript.filter((s: any) => s.text.toLowerCase().includes(q.toLowerCase().split(" ")[0])).map((s: any) => ({ meeting_id: m.id, title: m.title, started_at: m.started_at, source_type: "transcript", text: s.text, start_ms: s.start_ms, score: 1 })))),
  ask: () => ok({ answer: "Sai finished the certificate renewal for the payments cluster [c1]; the prod deploy moved to Thursday because of it.", found: true, provider: "mistral/mistral-small-latest",
    citations: [{ id: "c1", meeting_id: "m1", title: "Payments daily standup", start_ms: 6000, quote: "I finished the certificate renewal for the payments cluster yesterday." }] }),
  brief: (title: string) => ok({ open_action_items: [{ id: "a1", text: "Get VPN access for staging", owner: "Sai", due: "Friday", meeting_id: "m1", meeting_title: "Payments daily standup" }],
    last_meeting: /standup/i.test(title) ? { id: "m1", title: "Payments daily standup", started_at: now - 86400 } : null,
    last_decisions: /standup/i.test(title) ? ["Move the prod deploy to Thursday"] : [], last_blockers: /standup/i.test(title) ? ["VPN access for staging"] : [], last_open_questions: [], agenda: "" }),
  standup: {
    today: () => ok(null),
    generate: (notes: string) => ok({ id: "st1", date: new Date().toISOString().slice(0, 10), project_id: null, notes,
      done: ["Renewed the payments cluster certificate (OPS-142)"], doing: ["Moving the prod deploy to Thursday"], blockers: ["VPN access for staging"],
      script: "Yesterday I renewed the payments cluster certificate, OPS-142. Today I'm moving the prod deploy to Thursday. I'm blocked on VPN access for staging; if someone can approve that today, great." }),
    save: (e: any) => ok(e),
  },
  profile: { get: () => ok(profile), put: (p: any) => ok(p), presets: () => ok({ devops_sre: profile }) },
  voice: { list: () => ok([]), enroll: () => ok(null), delete: () => ok(undefined), onProgress: () => () => undefined },
  cardFeedback: () => ok(undefined),
  projects: (c: any) => ok(c?.op === "list" ? [{ id: "p1", name: "Payments", description: "", vocabulary: ["OPS-142", "ArgoCD"], role: "owner" }] : c?.op === "get" ? { id: "p1", name: "Payments", description: "", vocabulary: [], role: "owner" } : []),
  editMeeting: () => ok(undefined),
  watch: { start: () => ok(undefined), stop: () => ok(undefined), onEvent: () => () => undefined },
  integrations: (c: any) => ok(c?.op === "list" ? integrationsList : c?.op === "upcoming" ? upcoming : c?.op === "tickets" ? [] : c?.op === "preview" ? { target: c.target, text: meetings[c.meetingId] ? `# ${meetings[c.meetingId].title}\n\n${meetings[c.meetingId].summary.data.overview}` : "", preview_token: "demo" } : null),
  setup: (c: any) => ok(c?.op === "providers" ? [] : c?.op === "audioCheck" ? { mic: { state: "live", peak: 0.4 }, system: { state: "live", peak: 0.3 } } : null),
  privacy: {
    get: () => ok({ signedIn: true, settings: { allow_test_providers: false, retention_days: null, consent_message: "Heads up: I'm using Meeting Copilot to transcribe this meeting and take notes. Tell me if you'd rather I didn't, and I'll stop." },
      providers: [
        { name: "groq", kind: "llm", trains_on_data: false, local: false, tasks: ["card", "catchup", "clarify", "detect"], meeting_data_allowed: true },
        { name: "mistral", kind: "llm", trains_on_data: false, local: false, tasks: ["ask", "summary"], meeting_data_allowed: true },
        { name: "deepgram", kind: "stt_stream", trains_on_data: false, local: false, tasks: ["stt_live"], meeting_data_allowed: true },
        { name: "gemini", kind: "llm", trains_on_data: true, local: false, tasks: ["summary"], meeting_data_allowed: false },
      ] }),
    save: (s: any) => ok(s),
    announce: () => ok({ logged: state.capturing }),
    pause: () => ((state = { ...state, paused: true }), emit(), ok(state)),
    resume: () => ((state = { ...state, paused: false }), emit(), ok(state)),
    deleteMeeting: (id: string) => (delete meetings[id], emit(), ok(undefined)),
    exportAccount: () => ok(null),
    deleteAccount: () => ok(undefined),
  },
  secrets: { set: () => ok(undefined), has: () => ok(false), delete: () => ok(undefined) },
  capture: {},
};
export const demoApi = api as CopilotApi;
