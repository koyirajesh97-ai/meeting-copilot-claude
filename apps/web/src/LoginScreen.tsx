// The web app's front door: signed-out visitors see this instead of the app.

import { AudioLines, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LoginForm } from "@desktop/renderer/src/components/LoginForm";
import { normalizeServerUrl } from "./ConnectServer";
import { loadSettings, oauthError, saveSettings } from "./bridge/web";

const POINTS = [
  "Live captions for you and everyone on the call",
  "Answers to questions asked to you, as they're asked",
  "Summaries, decisions and action items when it ends",
  "Works with Meet, Teams and Zoom: no bot joins your call",
];

/** Rarely needed: point this site at a different Meeting Copilot server. */
function OtherServer() {
  const [url, setUrl] = useState(loadSettings().backendUrl);
  const [error, setError] = useState<string | null>(null);
  return (
    <details className="text-xs text-slate-500">
      <summary className="cursor-pointer">Using your own server?</summary>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = normalizeServerUrl(url);
          if (!clean) return setError("Enter an address like https://copilot.example.com");
          saveSettings({ backendUrl: clean });
          location.reload();
        }}
      >
        <input className="w-full rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900" aria-label="Server address" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" className="rounded-lg border border-slate-200 px-2 dark:border-slate-700">Use</button>
      </form>
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </details>
  );
}

export function LoginScreen() {
  const [devAvailable, setDevAvailable] = useState(false);
  useEffect(() => {
    void window.copilot.auth.devAvailable().then(setDevAvailable, () => undefined);
  }, []);
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]" data-testid="login-screen">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25" aria-hidden>
            <AudioLines size={20} />
          </span>
          <span className="text-lg font-semibold tracking-tight">Meeting Copilot</span>
        </div>
        <div className="my-auto max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Never miss what matters in a meeting.</h2>
          <ul className="mt-8 space-y-3 text-indigo-50">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-indigo-200" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-indigo-200">Your meetings stay private to you and the people you share them with.</p>
      </aside>
      <main className="flex items-center justify-center bg-white px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex items-center gap-2.5 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white" aria-hidden>
              <AudioLines size={20} />
            </span>
            <span className="text-lg font-semibold tracking-tight">Meeting Copilot</span>
          </div>
          <LoginForm initialError={oauthError} devAvailable={devAvailable} />
          <OtherServer />
        </div>
      </main>
    </div>
  );
}
