import { useEffect, useState } from "react";
import type { Settings } from "../../../shared/ipc";
import { useAppState } from "../useAppState";
import { buttonClass, inputClass, secondaryButtonClass } from "./EmptyState";

export function AccountSettings({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const state = useAppState();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devAvailable, setDevAvailable] = useState(false);

  useEffect(() => {
    void window.copilot.auth.devAvailable().then(setDevAvailable);
  }, [settings.backendUrl]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };

  const auth = state?.auth;
  return (
    <div className="space-y-4" data-testid="account">
      <h2 className="font-medium">Account</h2>
      {auth?.signedIn ? (
        <div className="flex items-center justify-between rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
          <span data-testid="signed-in-as">
            Signed in as <strong>{auth.email}</strong>
            {auth.kind === "dev" ? " (dev login)" : ""}
          </span>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void run(() => window.copilot.auth.signOut())}>
            Sign out
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Sign in to get live captions and keep your meetings in sync. We email you a one-time code.
          </p>
          <div className="flex gap-2">
            <input className={inputClass} type="email" placeholder="you@example.com" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="button" className={buttonClass} disabled={busy || !email.includes("@")} onClick={() => void run(async () => {
              await window.copilot.auth.sendCode(email);
              setSent(true);
            })}>
              Send code
            </button>
          </div>
          {sent && (
            <div className="flex gap-2">
              <input className={inputClass} inputMode="numeric" placeholder="6-digit code" aria-label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
              <button type="button" className={buttonClass} disabled={busy || code.trim().length < 6} onClick={() => void run(() => window.copilot.auth.verifyCode(email, code))}>
                Sign in
              </button>
            </div>
          )}
          {devAvailable && (
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void run(() => window.copilot.auth.devSignIn())}>
              Use the local dev login
            </button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500 dark:text-gray-400">Supabase project</summary>
        <div className="mt-2 space-y-2">
          <label className="block">
            Supabase URL
            <input className={`${inputClass} mt-1`} defaultValue={settings.supabaseUrl} onBlur={(e) => void update({ supabaseUrl: e.target.value })} />
          </label>
          <label className="block">
            Anon (public) key
            <input className={`${inputClass} mt-1 font-mono text-xs`} defaultValue={settings.supabaseAnonKey} onBlur={(e) => void update({ supabaseAnonKey: e.target.value.trim() })} />
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            From <code>supabase status</code> locally, or your project's API settings. The anon key is public; your data is protected by row-level security.
          </p>
        </div>
      </details>
    </div>
  );
}
