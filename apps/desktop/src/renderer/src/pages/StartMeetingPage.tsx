import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AppState, Brief, PrivacySettings, UpcomingMeeting } from "../../../shared/ipc";
import {
  DEFAULT_CONSENT_MESSAGE,
  MEETING_MODES,
  MEETING_TYPES,
  type MeetingMode,
  type MeetingType,
  type Visibility,
} from "../../../shared/meetings";
import { buttonClass, inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";
import { useProjects } from "../projects/useProjects";

export function StartMeetingPage({ state }: { state: AppState | null }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MeetingType>("standup");
  const [mode, setMode] = useState<MeetingMode>("cloud");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [copied, setCopied] = useState<string | null>(null);
  const [agenda, setAgenda] = useState("");
  const [brief, setBrief] = useState<Brief | null>(null);
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

  return (
    <section className="max-w-xl">
      <PageHeader title="Start meeting" />
      {event && (
        <p className="-mt-4 mb-4 text-sm text-gray-500 dark:text-gray-400" data-testid="from-calendar">
          From your calendar: {event.title}, {new Date(event.start * 1000).toLocaleTimeString(undefined, { timeStyle: "short" })}. Type guessed from the title; change it if it's wrong.
        </p>
      )}
      <div className="space-y-4">
        <label className="block text-sm">
          Title
          <input className={`${inputClass} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Daily standup" />
        </label>
        <label className="block text-sm">
          Project
          <select aria-label="Project" className={`${inputClass} mt-1`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Personal</option>
            {projects?.filter((p) => p.role !== "viewer").map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Meeting type
          <select className={`${inputClass} mt-1`} value={type} onChange={(e) => setType(e.target.value as MeetingType)}>
            {MEETING_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Agenda (optional)
          <textarea className={`${inputClass} mt-1`} rows={2} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </label>
        <fieldset className="text-sm">
          <legend>Mode</legend>
          <div className="mt-1 space-y-1">
            {MEETING_MODES.map((m) => (
              <label key={m.id} className="flex items-start gap-2">
                <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-1" />
                <span>
                  {m.label} <span className="text-gray-500 dark:text-gray-400">— {m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className={`flex items-center gap-2 text-sm ${projectId ? "" : "opacity-50"}`}>
          <input type="checkbox" disabled={!projectId} checked={visibility === "project" && !!projectId} onChange={(e) => setVisibility(e.target.checked ? "project" : "private")} />
          Share with the project
        </label>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() =>
              void (state?.capturing ? window.copilot.toggleCapture() : window.copilot.startMeeting({ title, type, mode, visibility: projectId ? visibility : "private", agenda, project_id: projectId || null, calendar_event_id: event?.id ?? null }))
            }
          >
            {state?.capturing ? "Stop recording" : "Start recording"}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => void announce()}>
            {copied ?? "Announce"}
          </button>
        </div>
        {state && !state.auth.signedIn && (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            You're not signed in, so this records to your computer only (no live captions). Sign in under Settings.
          </p>
        )}
        <label className="block text-sm">
          Consent message
          <textarea aria-label="Consent message" className={`${inputClass} mt-1`} rows={2} value={consent} onChange={(e) => setConsent(e.target.value)} />
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Announce copies this message to paste in the meeting chat so everyone knows you're recording, and notes that you announced it.
        </p>
      </div>
      {brief && <BriefPanel brief={brief} />}
    </section>
  );
}

function BriefPanel({ brief }: { brief: Brief }) {
  const empty = !brief.last_meeting && brief.open_action_items.length === 0 && !brief.agenda;
  if (empty) return null;
  return (
    <aside className="mt-8 space-y-3 rounded-md border border-gray-200 p-4 text-sm dark:border-gray-800" data-testid="brief" aria-label="Brief">
      <h2 className="font-medium">Before you start</h2>
      {brief.agenda && (
        <div>
          <h3 className="text-xs font-medium uppercase text-gray-500">Agenda</h3>
          <p className="whitespace-pre-line">{brief.agenda}</p>
        </div>
      )}
      {brief.last_meeting && (
        <div>
          <h3 className="text-xs font-medium uppercase text-gray-500">Last time ({brief.last_meeting.title})</h3>
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
          <h3 className="text-xs font-medium uppercase text-gray-500">Your open action items</h3>
          <ul className="list-disc pl-5" data-testid="brief-items">
            {brief.open_action_items.slice(0, 8).map((a) => (
              <li key={a.id}>
                {a.text}
                <span className="text-xs text-gray-500"> — {a.meeting_title}{a.due ? `, due ${a.due}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
