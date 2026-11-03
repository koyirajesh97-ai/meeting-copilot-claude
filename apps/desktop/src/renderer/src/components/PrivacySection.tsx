import { useEffect, useState } from "react";
import { DELETE_ACCOUNT_PHRASE, type PrivacySettings, type ProviderInfo } from "../../../shared/ipc";
import { errorText } from "../projects/useProjects";
import { useAppState } from "../useAppState";
import { buttonClass, inputClass, secondaryButtonClass } from "./EmptyState";

const TRAINS: Record<string, string> = { true: "May train on data", false: "Doesn't train", unknown: "Unknown (treated as may train)" };

/** Settings → Privacy: which AI services see meeting data, retention, export and delete. */
export function PrivacySection() {
  const [info, setInfo] = useState<{ settings: PrivacySettings; providers: ProviderInfo[]; signedIn: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const load = () => void window.copilot.privacy.get().then(setInfo, (e) => setNote(errorText(e)));
  const signedIn = useAppState()?.auth.signedIn;
  useEffect(load, [signedIn]);

  const save = async (patch: Partial<PrivacySettings>) => {
    if (!info) return;
    try {
      const settings = await window.copilot.privacy.save({ ...info.settings, ...patch });
      setInfo({ ...info, settings });
      load();
      setNote("Saved");
    } catch (e) {
      setNote(errorText(e));
    }
  };
  const run = async (fn: () => Promise<unknown>, done?: (r: unknown) => string | null) => {
    try {
      const r = await fn();
      setNote(done ? done(r) : null);
    } catch (e) {
      setNote(errorText(e));
    }
  };

  if (!info) return null;
  const s = info.settings;
  return (
    <div className="space-y-4" role="region" aria-label="Privacy">
      <h2 className="font-medium">Privacy</h2>
      {!info.signedIn && <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to see AI providers, retention, export and delete.</p>}
      {info.signedIn && (
        <>
          <div>
            <h3 className="mb-1 text-sm font-medium">AI providers</h3>
            <table className="w-full text-xs" data-testid="providers">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-1">Provider</th>
                  <th>Training on your data</th>
                  <th>Meeting data</th>
                  <th>Used for</th>
                </tr>
              </thead>
              <tbody>
                {info.providers.map((p) => (
                  <tr key={p.name} className="border-t border-gray-200 dark:border-gray-800" data-provider={p.name}>
                    <td className="py-1 font-medium">
                      {p.name}
                      {p.local && <span className="ml-1 rounded bg-emerald-100 px-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">this computer</span>}
                    </td>
                    <td>{TRAINS[String(p.trains_on_data)]}</td>
                    <td>{p.meeting_data_allowed ? "Allowed" : "Test data only"}</td>
                    <td className="text-gray-500">{p.tasks.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={s.allow_test_providers} onChange={(e) => void save({ allow_test_providers: e.target.checked })} />
            <span>
              Allow test-only providers for meeting data
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Off by default. These providers may use what you send to train their models; leave it off for real meetings.
              </span>
            </span>
          </label>
          <label className="block text-sm">
            Delete meetings older than
            <select
              aria-label="Retention"
              className={`${inputClass} mt-1`}
              value={s.retention_days ?? ""}
              onChange={(e) => void save({ retention_days: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Keep until I delete them</option>
              {[7, 30, 90, 180, 365].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Consent message
            <textarea
              aria-label="Default consent message"
              className={`${inputClass} mt-1`}
              rows={2}
              defaultValue={s.consent_message}
              onBlur={(e) => e.target.value.trim() && e.target.value !== s.consent_message && void save({ consent_message: e.target.value.trim() })}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => void run(() => window.copilot.privacy.exportAccount(), (p) => (p ? `Saved to ${p as string}` : null))}>
              Export my data
            </button>
          </div>
          <div className="rounded-md border border-red-300 p-3 dark:border-red-900">
            <h3 className="text-sm font-medium text-red-700 dark:text-red-400">Delete my account</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Deletes your meetings, transcripts, summaries, voiceprints and profile, on the server and on this computer. Type "{DELETE_ACCOUNT_PHRASE}" to confirm.
            </p>
            <div className="mt-2 flex gap-2">
              <input aria-label="Type to confirm account deletion" className={inputClass} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
              <button
                type="button"
                className={`${buttonClass} bg-red-600 hover:bg-red-700`}
                disabled={phrase !== DELETE_ACCOUNT_PHRASE}
                onClick={() => void run(() => window.copilot.privacy.deleteAccount(phrase), () => "Your account was deleted.")}
              >
                Delete account
              </button>
            </div>
          </div>
        </>
      )}
      {note && <p role="status" className="text-xs text-gray-500 dark:text-gray-400" data-testid="privacy-note">{note}</p>}
    </div>
  );
}
