import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AppState, Brief, PrivacySettings, UpcomingMeeting } from "../../../shared/ipc";
import {
  DEFAULT_CONSENT_MESSAGE,
  MEETING_MODES,
  MEETING_TYPES,
  type MeetingMode,
  type MeetingType,
  type Visibility,
} from "../../../shared/meetings";
import { buttonClass, inputClass, secondaryButtonClass } from "../components/EmptyState";
import { useProjects } from "../projects/useProjects";
import { useSettings } from "../useAppState";

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

  const start = () =>
    void (state?.capturing
      ? window.copilot.toggleCapture()
      : window.copilot.startMeeting({ title, type, mode, visibility: projectId ? visibility : "private", agenda, project_id: projectId || null, calendar_event_id: event?.id ?? null }));

  return (
    <section className="mx-auto max-w-lg pt-6">
      <h1 className="text-2xl font-semibold">Start meeting</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400" data-testid={event ? "from-calendar" : undefined}>
        {event ? `From your calendar: ${event.title}` : "Give it a name, press Start, and join your call as usual."}
      </p>

      <div className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="sr-only">Title</span>
          <input
            aria-label="Title"
            className={`${inputClass} py-2.5 text-base`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting name (optional)"
          />
        </label>
        <div className="flex gap-2">
          <button type="button" className={`${buttonClass} flex-1 py-2.5 text-base`} onClick={start}>
            {state?.capturing ? "Stop recording" : "Start recording"}
          </button>
          <button type="button" className={secondaryButtonClass} title="Copy a short message for the meeting chat so everyone knows you're recording" onClick={() => void announce()}>
            {copied ?? "Announce"}
          </button>
        </div>
        {state && !state.auth.signedIn && (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            You're not signed in, so this only records to your computer (no live captions). Sign in under Settings.
          </p>
        )}
        {type === "standup" && (
          <Link to="/standup" className="block text-sm text-blue-600 underline dark:text-blue-400">
            Prep my standup update first
          </Link>
        )}

        <details className="group rounded-lg border border-gray-200 text-sm dark:border-gray-800" open={!!eventId}>
          <summary className="cursor-pointer select-none px-3 py-2 text-gray-600 dark:text-gray-300">More options</summary>
          <div className="space-y-4 border-t border-gray-200 p-3 dark:border-gray-800">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                Meeting type
                <select className={`${inputClass} mt-1`} value={type} onChange={(e) => setType(e.target.value as MeetingType)}>
                  {MEETING_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
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
            </div>
            {projectId && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={visibility === "project"} onChange={(e) => setVisibility(e.target.checked ? "project" : "private")} />
                Share with the project
              </label>
            )}
            <fieldset>
              <legend>Privacy</legend>
              <div className="mt-1 space-y-1">
                {MEETING_MODES.map((m) => (
                  <label key={m.id} className="flex items-start gap-2">
                    <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => (setMode(m.id), setModeTouched(true))} className="mt-1" />
                    <span>
                      {m.label} <span className="text-gray-500 dark:text-gray-400">— {m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              Agenda
              <textarea className={`${inputClass} mt-1`} rows={2} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
            </label>
            <label className="block">
              Consent message (copied by Announce)
              <textarea aria-label="Consent message" className={`${inputClass} mt-1`} rows={2} value={consent} onChange={(e) => setConsent(e.target.value)} />
            </label>
          </div>
        </details>
      </div>
      {brief && <BriefPanel brief={brief} />}
    </section>
  );
}

function BriefPanel({ brief }: { brief: Brief }) {
  const empty = !brief.last_meeting && brief.open_action_items.length === 0 && !brief.agenda;
  if (empty) return null;
  return (
    <aside className="mt-6 space-y-3 rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-900" data-testid="brief" aria-label="Brief">
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
