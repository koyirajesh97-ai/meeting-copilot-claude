import { useEffect, useState } from "react";
import type { Settings } from "../../../shared/ipc";
import { useAppState } from "../useAppState";
import { buttonClass, inputClass, secondaryButtonClass } from "./EmptyState";
import { errorMessage, LoginForm } from "./LoginForm";

/** Sign-in. `compact` (first-run setup) leaves out the heading and the server fields. */
export function AccountSettings({ settings, update, compact = false }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void>; compact?: boolean }) {
  const state = useAppState();
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
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const auth = state?.auth;
  return (
    <div className="space-y-4" data-testid="account">
      {!compact && <h2 className="font-medium">Account</h2>}
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
        <div className="max-w-sm">
          <LoginForm devAvailable={devAvailable} />
        </div>
      )}
      {auth?.signedIn && auth.kind === "supabase" && !compact && <ChangePassword />}
      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {!compact && <ServerFields settings={settings} update={update} title="Supabase project" />}
    </div>
  );
}

/** Where the app connects to: Supabase (sign-in) and, in setup, the backend. Rarely changed. */
export function ServerFields({ settings, update, title, children }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void>; title: string; children?: React.ReactNode }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-gray-500 dark:text-gray-400">{title}</summary>
      {children}
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
  );
}

/** Set or change the password (accounts made with a code or Google may not have one yet). */
function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(true)}>
        Set or change your password
      </button>
    );
  }
  return (
    <form
      className="flex max-w-sm gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void window.copilot.auth
          .setPassword(password)
          .then(() => {
            setNote({ ok: true, text: "Password saved." });
            setPassword("");
          }, (err) => setNote({ ok: false, text: errorMessage(err) }))
          .finally(() => setBusy(false));
      }}
    >
      <input className={inputClass} type="password" autoComplete="new-password" aria-label="New password" placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className={buttonClass} disabled={busy || password.length < 8}>Save</button>
      {note && <p className={`self-center text-xs ${note.ok ? "text-green-700" : "text-red-600"}`} role="status">{note.text}</p>}
    </form>
  );
}
