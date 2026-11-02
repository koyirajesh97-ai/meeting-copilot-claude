import { useState } from "react";
import type { AppState } from "../../../shared/ipc";
import {
  DEFAULT_CONSENT_MESSAGE,
  MEETING_MODES,
  MEETING_TYPES,
  type MeetingMode,
  type MeetingType,
  type Visibility,
} from "../../../shared/meetings";
import { buttonClass, inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";

export function StartMeetingPage({ state }: { state: AppState | null }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MeetingType>("standup");
  const [mode, setMode] = useState<MeetingMode>("cloud");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [copied, setCopied] = useState(false);

  const announce = async () => {
    await navigator.clipboard.writeText(DEFAULT_CONSENT_MESSAGE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="max-w-xl">
      <PageHeader title="Start meeting" />
      <div className="space-y-4">
        <label className="block text-sm">
          Title
          <input className={`${inputClass} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Daily standup" />
        </label>
        <label className="block text-sm">
          Project
          <select className={`${inputClass} mt-1`} disabled>
            <option>Personal (projects arrive in Phase 3)</option>
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={visibility === "project"} onChange={(e) => setVisibility(e.target.checked ? "project" : "private")} />
          Share with the project
        </label>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() =>
              void (state?.capturing ? window.copilot.toggleCapture() : window.copilot.startMeeting({ title, type, mode, visibility }))
            }
          >
            {state?.capturing ? "Stop recording" : "Start recording"}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => void announce()}>
            {copied ? "Copied consent message" : "Announce"}
          </button>
        </div>
        {state && !state.auth.signedIn && (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            You're not signed in, so this records to your computer only (no live captions). Sign in under Settings.
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Announce copies a short message to paste in the meeting chat so everyone knows you're recording.
        </p>
      </div>
    </section>
  );
}
