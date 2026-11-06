// Shown when the site has no backend configured: the user enters their own Meeting Copilot
// server (and Supabase project for sign-in). The server is checked before it's saved.

import { AudioLines } from "lucide-react";
import { useState } from "react";
import { buttonClass, inputClass } from "@desktop/renderer/src/components/EmptyState";
import { saveSettings } from "./bridge/web";

/** "api.example.com/" -> "https://api.example.com"; null if it isn't an http(s) URL. */
export function normalizeServerUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Ask the server's /health; a Meeting Copilot backend answers {"status": "ok"}. */
export async function checkServer(url: string, fetchImpl: typeof fetch = (i, o) => fetch(i, o)): Promise<string | null> {
  try {
    const res = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return `The server answered ${res.status}.`;
    const body = (await res.json()) as { status?: string };
    return body.status === "ok" ? null : "That isn't a Meeting Copilot server.";
  } catch {
    return "Couldn't reach it. Check the address, and that the server allows this site (COPILOT_WEB_ORIGINS).";
  }
}

export function ConnectServer() {
  const [server, setServer] = useState("");
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseKey, setSupabaseKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const url = normalizeServerUrl(server);
    if (!url) return setError("Enter your server's address, for example https://copilot.example.com");
    setBusy(true);
    setError(null);
    const problem = await checkServer(url);
    setBusy(false);
    if (problem) return setError(problem);
    saveSettings({ backendUrl: url, ...(supabaseUrl.trim() ? { supabaseUrl: supabaseUrl.trim() } : {}), ...(supabaseKey.trim() ? { supabaseAnonKey: supabaseKey.trim() } : {}) });
    location.reload();
  };

  return (
    <main className="grid min-h-full place-items-center px-4 py-10">
      <form
        className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white" aria-hidden>
            <AudioLines size={19} />
          </span>
          <h1 className="text-lg font-semibold">Connect to your Meeting Copilot server</h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your meetings live on your own server. Enter its address to sign in and start recording.
        </p>
        <label className="block text-sm">
          Server address
          <input className={`${inputClass} mt-1`} inputMode="url" autoComplete="url" placeholder="https://copilot.example.com" value={server} onChange={(e) => setServer(e.target.value)} />
        </label>
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">Sign-in project (Supabase)</summary>
          <p className="mt-2 text-xs text-slate-500">Only if your server's admin gave you these. The anon key is public; never paste an AI provider key here.</p>
          <label className="mt-2 block">
            Supabase URL
            <input className={`${inputClass} mt-1`} placeholder="https://xxxx.supabase.co" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} />
          </label>
          <label className="mt-2 block">
            Supabase anon key
            <input className={`${inputClass} mt-1`} value={supabaseKey} onChange={(e) => setSupabaseKey(e.target.value)} />
          </label>
        </details>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" className={`${buttonClass} w-full justify-center`} disabled={busy}>
          {busy ? "Checking…" : "Connect"}
        </button>
      </form>
    </main>
  );
}
