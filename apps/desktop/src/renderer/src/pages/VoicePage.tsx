import { useEffect, useState } from "react";
import { ENROLL_SECONDS, VOICE_CONSENT_TEXT, type EnrolledVoice } from "../../../shared/ipc";
import { buttonClass, inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";
import { useAppState } from "../useAppState";

const PASSAGE =
  "The deploy pipeline runs every morning at nine. If the certificate check fails, we roll back " +
  "and page the on-call engineer. Last quarter we moved most services to the new cluster, and the " +
  "remaining ones follow after the holiday freeze. Please read this at your normal pace, as if you " +
  "were talking in a meeting. One, two, three, four, five, six, seven, eight, nine, ten.";

export function VoicePage() {
  const state = useAppState();
  const [voices, setVoices] = useState<EnrolledVoice[] | null>(null);
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<{ elapsed: number; level: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    void window.copilot.voice
      .list()
      .then(setVoices)
      .catch(() => setVoices([]));
  useEffect(load, []);
  useEffect(() => window.copilot.voice.onProgress(setProgress), []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
      load();
    } catch (err) {
      setMessage((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (state && !state.auth.signedIn) {
    return (
      <section className="max-w-2xl">
        <PageHeader title="Your voice" />
        <p className="text-sm">Sign in (Settings → Account) to enroll your voice.</p>
      </section>
    );
  }

  return (
    <section className="max-w-2xl space-y-6">
      <PageHeader title="Your voice" />
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Your microphone is always labeled "You". Enrolling lets teammates' copies of the app recognize you by name when
        you're in their meetings' audio. It's optional.
      </p>

      {voices && voices.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-medium">Enrolled</h2>
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {voices.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-3 py-2 text-sm" data-testid="enrolled-voice">
                <span>
                  {v.display_name}
                  <span className="ml-2 text-xs text-gray-500">consent given {new Date(v.consent_at * 1000).toLocaleDateString()}</span>
                </span>
                <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void run(() => window.copilot.voice.delete(v.id), "Your voiceprint was deleted.")}>
                  Delete my voiceprint
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-800">
        <h2 className="font-medium">{voices?.length ? "Record again" : "Enroll your voice"}</h2>
        <p className="text-sm" data-testid="consent-text">{VOICE_CONSENT_TEXT}</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>I agree to a voiceprint being made from my recording, as described above.</span>
        </label>
        <label className="block text-sm">
          Name to show
          <input className={`${inputClass} mt-1`} placeholder={state?.auth.email ?? "Your name"} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {progress ? (
          <div className="space-y-2" role="status">
            <p className="text-sm">Read this aloud ({Math.max(0, Math.ceil(progress.total - progress.elapsed))} s left):</p>
            <blockquote className="rounded bg-gray-50 p-3 text-sm italic dark:bg-gray-900">{PASSAGE}</blockquote>
            <div className="h-1.5 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
              <div className="h-full bg-green-500" style={{ width: `${Math.round(progress.level * 100)}%` }} />
            </div>
          </div>
        ) : (
          <blockquote className="rounded bg-gray-50 p-3 text-sm italic text-gray-500 dark:bg-gray-900">{PASSAGE}</blockquote>
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={!consent || busy || state?.capturing}
          onClick={() => void run(() => window.copilot.voice.enroll(name, consent), "Enrolled. Your voice will be recognized in your projects' meetings.")}
        >
          {busy ? "Recording…" : `Record ${ENROLL_SECONDS} seconds`}
        </button>
        {state?.capturing && <p className="text-xs text-gray-500">Stop the meeting recording first.</p>}
      </div>
      {message && <p className="text-sm" role="alert">{message}</p>}
    </section>
  );
}
