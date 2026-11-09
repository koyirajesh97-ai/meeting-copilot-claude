import { useEffect, useState } from "react";
import { Cable, Check, Cloud, HardDrive, Megaphone, Mic, MonitorUp, Radio, Sparkles, Speaker, Square, Zap } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { AppState, Brief, MeetingAudioSource, PrivacySettings, SessionTools, UpcomingMeeting } from "../../../shared/ipc";
import {
  DEFAULT_CONSENT_MESSAGE,
  MEETING_MODES,
  MEETING_TYPES,
  type MeetingMode,
  type MeetingType,
  type Visibility,
} from "../../../shared/meetings";
import { inputClass, secondaryButtonClass } from "../components/EmptyState";
import { MODE_INFO, TypeTile } from "../components/meetingTypes";
import { useProjects } from "../projects/useProjects";
import { useSettings } from "../useAppState";

const PRIVACY_ICON: Record<MeetingMode, typeof Cloud> = { cloud: Cloud, "live-only": Radio, local: HardDrive };

const TOOLS: { key: keyof SessionTools; label: string; hint: string }[] = [
  { key: "answers", label: "Answer questions asked to you", hint: "A card with what to say, from your notes and past meetings, the moment someone asks you." },
  { key: "topics", label: "Topic briefings", hint: "When a system or ticket you own comes up, a quick fact card from your project knowledge." },
];

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-600/10 text-xs text-indigo-600 ring-1 ring-indigo-600/20 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/30">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const AUDIO_KEY = "meeting-copilot.audio-source";

/** The last audio source chosen in this browser (a convenience; sharing when unknown). */
function loadAudioChoice(): MeetingAudioSource {
  try {
    const v = JSON.parse(localStorage.getItem(AUDIO_KEY) ?? "null") as MeetingAudioSource | null;
    if (v && (v.kind === "share" || v.kind === "room" || (v.kind === "device" && typeof v.deviceId === "string"))) return v;
  } catch {
    /* no storage */
  }
  return { kind: "share" };
}
function saveAudioChoice(v: MeetingAudioSource): void {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(v));
  } catch {
    /* no storage */
  }
}

const AUDIO_OPTIONS: { kind: MeetingAudioSource["kind"]; label: string; hint: string; icon: typeof Cloud }[] = [
  { kind: "share", label: "This computer", hint: "Share the meeting's tab or window (Chrome, Edge). Your mic is added.", icon: MonitorUp },
  { kind: "room", label: "Another device or the room", hint: "No sharing. Your mic listens to the room, or a phone or laptop on speaker.", icon: Speaker },
  { kind: "device", label: "External audio input", hint: "A mixer, audio interface or virtual cable (BlackHole, VB-Cable, Loopback).", icon: Cable },
];

/** Web app: where the meeting audio comes from. */
function AudioSourcePicker({ value, onChange }: { value: MeetingAudioSource; onChange: (v: MeetingAudioSource) => void }) {
  const [inputs, setInputs] = useState<{ deviceId: string; label: string }[] | null>(null);
  useEffect(() => {
    if (value.kind === "device" && inputs === null) void window.copilot.audioInputs?.().then(setInputs, () => setInputs([]));
  }, [value.kind, inputs]);
  const pick = (kind: MeetingAudioSource["kind"]) => {
    if (kind === "device") {
      const first = value.kind === "device" ? value.deviceId : (inputs?.[0]?.deviceId ?? "");
      onChange({ kind: "device", deviceId: first, withMic: true });
    } else onChange({ kind });
  };
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Meeting audio" className="grid gap-3 sm:grid-cols-3">
        {AUDIO_OPTIONS.map((o) => {
          const on = value.kind === o.kind;
          const Icon = o.icon;
          return (
            <label
              key={o.kind}
              className={`relative flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition focus-within:ring-2 focus-within:ring-indigo-500/40 ${
                on ? "border-cyan-500/60 bg-cyan-50 dark:border-cyan-400/50 dark:bg-cyan-400/10" : "border-slate-200 hover:border-cyan-300 dark:border-white/[0.08] dark:hover:border-cyan-400/40"
              }`}
            >
              <input type="radio" name="audio" checked={on} onChange={() => pick(o.kind)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${o.label} — ${o.hint}`} />
              <Icon size={18} className={`mt-0.5 shrink-0 ${on ? "text-cyan-600 dark:text-cyan-300" : "text-slate-400"}`} aria-hidden />
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      {value.kind === "device" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            aria-label="Audio input"
            className={`${inputClass} max-w-sm`}
            value={value.deviceId}
            onChange={(e) => onChange({ ...value, deviceId: e.target.value })}
          >
            {inputs === null && <option value="">Finding audio inputs…</option>}
            {inputs?.length === 0 && <option value="">No audio inputs found</option>}
            {inputs?.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.withMic !== false} onChange={(e) => onChange({ ...value, withMic: e.target.checked })} />
            Also record my microphone
          </label>
        </div>
      )}
      {value.kind === "room" && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Everything your mic hears counts as the meeting, so voices are told apart (Speaker 1, Speaker 2…). Put the other device on speaker, close to this one.
        </p>
      )}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-gradient-to-r from-indigo-500 to-violet-500" : "bg-slate-300 dark:bg-white/10"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Launch a session: pick the copilot's mode, give it context, choose its tools, start. */
export function StartMeetingPage({ state }: { state: AppState | null }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MeetingType>("standup");
  const [mode, setMode] = useState<MeetingMode>("cloud");
  const [settings] = useSettings();
  const [modeTouched, setModeTouched] = useState(false);
  useEffect(() => {
    if (settings && !modeTouched) setMode(settings.defaultMode);
  }, [settings, modeTouched]);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [copied, setCopied] = useState<string | null>(null);
  const [agenda, setAgenda] = useState("");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [tools, setTools] = useState<Required<SessionTools>>({ answers: true, topics: true });
  // Browser sessions choose where the meeting audio comes from; the desktop app captures it itself.
  const pickAudio = typeof window.copilot.audioInputs === "function";
  const [audio, setAudioState] = useState<MeetingAudioSource>(loadAudioChoice);
  const setAudio = (v: MeetingAudioSource) => {
    setAudioState(v);
    saveAudioChoice(v);
  };
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState("");
  // Started from a calendar event (Upcoming, or the 1-minute nudge): fill in what it tells us.
  const [params] = useSearchParams();
  const eventId = params.get("event");
  const [event, setEvent] = useState<UpcomingMeeting | null>(null);
  useEffect(() => {
    if (!eventId) return;
    void window.copilot.integrations<UpcomingMeeting[]>({ op: "upcoming" }).then((list) => {
      const e = list.find((x) => x.id === eventId);
      if (!e) return;
      setEvent(e);
      setTitle(e.title);
      if (MEETING_TYPES.some((t) => t.id === e.guessed_type)) setType(e.guessed_type as MeetingType);
      setAgenda(e.agenda);
    }, () => undefined);
  }, [eventId]);

  // Pre-meeting brief: your open action items and what happened last time in this series.
  useEffect(() => {
    if (!state?.auth.signedIn) return;
    const t = setTimeout(() => {
      void window.copilot.brief(title, type, agenda).then(setBrief).catch(() => setBrief(null));
    }, 400);
    return () => clearTimeout(t);
  }, [title, type, agenda, state?.auth.signedIn]);

  const [consent, setConsent] = useState(DEFAULT_CONSENT_MESSAGE);
  const [savedConsent, setSavedConsent] = useState<PrivacySettings | null>(null);
  useEffect(() => {
    void window.copilot.privacy.get().then((p) => {
      setConsent(p.settings.consent_message);
      if (p.signedIn) setSavedConsent(p.settings);
    }, () => undefined);
  }, [state?.auth.signedIn]);

  const announce = async () => {
    const r = await window.copilot.privacy.announce(consent);
    // An edited message becomes your default.
    if (savedConsent && consent.trim() && consent !== savedConsent.consent_message) {
      void window.copilot.privacy.save({ ...savedConsent, consent_message: consent.trim() }).then(setSavedConsent);
    }
    setCopied(r.logged ? "Copied and logged" : "Copied consent message");
    setTimeout(() => setCopied(null), 2500);
  };

  const capturing = !!state?.capturing;
  const start = () =>
    void (capturing
      ? window.copilot.toggleCapture()
      : window.copilot.startMeeting({
          title,
          type,
          mode,
          visibility: projectId ? visibility : "private",
          agenda,
          project_id: projectId || null,
          calendar_event_id: event?.id ?? null,
          tools,
          ...(pickAudio ? { audio: audio.kind === "device" && !audio.deviceId ? { kind: "room" as const } : audio } : {}),
        }));

  const info = MODE_INFO[type] ?? MODE_INFO.custom;
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-cyan-300/90">
          <Sparkles size={13} aria-hidden /> New session
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Launch your <span className="text-gradient">copilot</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400" data-testid={event ? "from-calendar" : undefined}>
          {event ? `From your calendar: ${event.title}` : "Pick a mode, give it context, press Start, and join your call as usual. No bot joins."}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          <Section step={1} title="What kind of meeting?">
            <div role="radiogroup" aria-label="Copilot mode" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {MEETING_TYPES.map((t) => {
                const m = MODE_INFO[t.id] ?? MODE_INFO.custom;
                const on = type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={m.name}
                    title={t.label}
                    onClick={() => setType(t.id)}
                    className={`group relative rounded-2xl border p-3 text-left transition ${
                      on
                        ? "border-indigo-500/60 bg-indigo-50 ring-2 ring-indigo-500/30 dark:border-indigo-400/50 dark:bg-indigo-500/10 dark:ring-indigo-400/25"
                        : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-indigo-400/40 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    {on && (
                      <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-white dark:bg-indigo-400 dark:text-slate-950" aria-hidden>
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                    <TypeTile type={t.id} />
                    <span className="mt-2 block text-sm font-semibold">{m.name}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-slate-400">{m.blurb}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {pickAudio && (
            <Section step={2} title="Where's the meeting audio?">
              <AudioSourcePicker value={audio} onChange={setAudio} />
            </Section>
          )}

          <Section step={pickAudio ? 3 : 2} title="Give your copilot context">
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <input aria-label="Title" className={`${inputClass} py-2.5`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting name (optional)" />
              <select aria-label="Project" className={`${inputClass} py-2.5`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Personal</option>
                {projects?.filter((p) => p.role !== "viewer").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              aria-label="Agenda"
              className={inputClass}
              rows={3}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="Agenda, goals or notes. The copilot uses them for answers, the brief and the summary."
            />
            {projectId && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={visibility === "project"} onChange={(e) => setVisibility(e.target.checked ? "project" : "private")} />
                Share with the project
              </label>
            )}
          </Section>

          <Section step={pickAudio ? 4 : 3} title="Adaptive tools">
            <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-white/[0.06] dark:border-white/[0.08] dark:bg-white/[0.03]">
              {TOOLS.map((t) => (
                <li key={t.key} className="flex items-center gap-4 p-4">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{t.hint}</span>
                  </span>
                  <Switch label={t.label} on={tools[t.key]} onChange={(v) => setTools({ ...tools, [t.key]: v })} />
                </li>
              ))}
              <li className="flex items-center gap-4 p-4 text-sm">
                <Zap size={16} className="shrink-0 text-amber-500" aria-hidden />
                <span className="text-slate-500 dark:text-slate-400">
                  Always on: live captions, <strong className="font-medium text-slate-700 dark:text-slate-200">Ask the copilot</strong>, Catch me up, Clarify, I'll follow up and the talk-time meter.
                </span>
              </li>
            </ul>
          </Section>

          <Section step={pickAudio ? 5 : 4} title="Privacy">
            <div role="radiogroup" aria-label="Privacy" className="grid gap-3 sm:grid-cols-3">
              {MEETING_MODES.map((m) => {
                const Icon = PRIVACY_ICON[m.id];
                const on = mode === m.id;
                return (
                  <label
                    key={m.id}
                    className={`relative flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition focus-within:ring-2 focus-within:ring-indigo-500/40 ${
                      on ? "border-indigo-500/60 bg-indigo-50 dark:border-indigo-400/50 dark:bg-indigo-500/10" : "border-slate-200 hover:border-indigo-300 dark:border-white/[0.08] dark:hover:border-indigo-400/40"
                    }`}
                  >
                    <input type="radio" name="mode" value={m.id} checked={on} onChange={() => (setMode(m.id), setModeTouched(true))} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${m.label} — ${m.hint}`} />
                    <Icon size={18} className={`mt-0.5 shrink-0 ${on ? "text-indigo-600 dark:text-indigo-300" : "text-slate-400"}`} aria-hidden />
                    <span>
                      <span className="block font-medium">{m.label}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{m.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <details className="text-sm" open={!!eventId}>
              <summary className="cursor-pointer select-none text-slate-500 dark:text-slate-400">More options</summary>
              <label className="mt-2 block">
                Consent message (copied by Announce)
                <textarea aria-label="Consent message" className={`${inputClass} mt-1`} rows={2} value={consent} onChange={(e) => setConsent(e.target.value)} />
              </label>
            </details>
          </Section>

          {state && !state.auth.signedIn && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
              You're not signed in, so this only records to your computer (no live captions). Sign in under Settings.
            </p>
          )}

          <div className="sticky bottom-0 -mx-2 flex gap-3 bg-gradient-to-t from-white via-white to-white/0 px-2 pb-2 pt-6 dark:from-slate-950 dark:via-slate-950/95 dark:to-slate-950/0">
            <button
              type="button"
              onClick={start}
              className={`flex flex-1 items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-base font-semibold text-white transition hover:brightness-110 ${
                capturing ? "bg-gradient-to-r from-rose-500 to-red-600 shadow-lg shadow-rose-600/30" : "glow pulse-ring bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
              }`}
            >
              {capturing ? <Square size={17} aria-hidden /> : <Mic size={18} aria-hidden />}
              {capturing ? "Stop recording" : "Start recording"}
            </button>
            <button type="button" className={`${secondaryButtonClass} rounded-2xl px-4`} title="Copy a short message for the meeting chat so everyone knows you're recording" onClick={() => void announce()}>
              <Megaphone size={16} aria-hidden />
              {copied ?? "Announce"}
            </button>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="glass rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-50 to-white p-4 dark:border-white/[0.08] dark:from-indigo-500/10 dark:to-cyan-400/5" data-testid="mode-preview">
            <div className="flex items-center gap-3">
              <TypeTile type={type} />
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Copilot mode</p>
                <p className="font-semibold">{info.name}</p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {info.perks.map((p) => (
                <li key={p} className="flex items-start gap-2">
                  <Check size={15} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
            {type === "standup" && (
              <Link to="/standup" className="mt-3 block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                Prep my standup update first
              </Link>
            )}
          </div>
          {brief && <BriefPanel brief={brief} />}
        </aside>
      </div>
    </div>
  );
}

function BriefPanel({ brief }: { brief: Brief }) {
  const empty = !brief.last_meeting && brief.open_action_items.length === 0 && !brief.agenda;
  if (empty) return null;
  return (
    <aside className="glass space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-white/[0.08] dark:bg-white/[0.03]" data-testid="brief" aria-label="Brief">
      <h2 className="font-semibold">Before you start</h2>
      {brief.agenda && (
        <div>
          <h3 className="text-xs font-medium uppercase text-slate-500">Agenda</h3>
          <p className="whitespace-pre-line">{brief.agenda}</p>
        </div>
      )}
      {brief.last_meeting && (
        <div>
          <h3 className="text-xs font-medium uppercase text-slate-500">Last time ({brief.last_meeting.title})</h3>
          <ul className="list-disc pl-5">
            {brief.last_decisions.map((d, i) => <li key={`d${i}`}>Decided: {d}</li>)}
            {brief.last_blockers.map((b, i) => <li key={`b${i}`}>Blocker: {b}</li>)}
            {brief.last_open_questions.map((q, i) => <li key={`q${i}`}>Open: {q}</li>)}
            {brief.last_decisions.length + brief.last_blockers.length + brief.last_open_questions.length === 0 && <li>No open points.</li>}
          </ul>
        </div>
      )}
      {brief.open_action_items.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase text-slate-500">Your open action items</h3>
          <ul className="list-disc pl-5" data-testid="brief-items">
            {brief.open_action_items.slice(0, 8).map((a) => (
              <li key={a.id}>
                {a.text}
                <span className="text-xs text-slate-500"> — {a.meeting_title}{a.due ? `, due ${a.due}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
