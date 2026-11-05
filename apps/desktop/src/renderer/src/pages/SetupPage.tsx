import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AudioCheck, ProviderKey, RoleProfile, Settings } from "../../../shared/ipc";
import { AccountSettings, ServerFields } from "../components/AccountSettings";
import { buttonClass, inputClass, secondaryButtonClass } from "../components/EmptyState";
import { errorText } from "../projects/useProjects";
import { useAppState, useSettings } from "../useAppState";

type Step = "signin" | "keys" | "audio" | "you";
const LABEL: Record<Step, string> = { signin: "Sign in", keys: "AI keys", audio: "Check audio", you: "About you" };

/**
 * First run, kept short: sign in, check the audio, say who you are. The AI-keys step appears only
 * when the backend is missing a key it needs. Everything can be skipped and changed in Settings.
 */
export function SetupPage() {
  const [settings, update] = useSettings();
  const signedIn = useAppState()?.auth.signedIn;
  const [index, setIndex] = useState(0);
  const [needsKeys, setNeedsKeys] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    if (!signedIn) return;
    void window.copilot.setup<ProviderKey[]>({ op: "providers" }).then((rows) => setNeedsKeys(rows.some((r) => r.required && !r.has_key)), () => undefined);
  }, [signedIn]);
  if (!settings) return null;
  const steps: Step[] = ["signin", ...(needsKeys ? (["keys"] as Step[]) : []), "audio", "you"];
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const finish = async () => {
    await update({ setupDone: true });
    navigate("/");
  };
  return (
    <section className="mx-auto max-w-lg pt-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Welcome to Meeting Copilot</h1>
        <button type="button" className="text-sm text-gray-500 underline" onClick={() => void finish()}>
          Skip
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Live captions and help in any meeting, no bot joins. {steps.length} quick steps.
      </p>
      <ol className="mt-5 flex gap-2" aria-label="Setup steps">
        {steps.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={`h-1.5 rounded-full ${i <= index ? "bg-indigo-600" : "bg-gray-200 dark:bg-gray-800"}`} />
            <span className={`mt-1 block text-xs ${i === index ? "font-medium" : "text-gray-500"}`} aria-current={i === index ? "step" : undefined}>
              {LABEL[s]}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-6" data-testid={`setup-step-${step}`}>
        {step === "signin" && <SignInStep settings={settings} update={update} />}
        {step === "keys" && <KeysStep />}
        {step === "audio" && <AudioStep />}
        {step === "you" && <RoleStep />}
      </div>
      <div className="mt-8 flex justify-between">
        <button type="button" className={secondaryButtonClass} disabled={index === 0} onClick={() => setIndex(index - 1)}>
          Back
        </button>
        <button type="button" className={buttonClass} onClick={() => (last ? void finish() : setIndex(index + 1))}>
          {last ? "Finish" : "Next"}
        </button>
      </div>
    </section>
  );
}

function Meter({ label, value, state }: { label: string; value: number; state: string }) {
  return (
    <div className="text-sm">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="text-xs text-gray-500">{state}</span>
      </div>
      <div className="h-2 rounded bg-gray-200 dark:bg-gray-800" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <div className="h-2 rounded bg-green-500" style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

function AudioStep() {
  const state = useAppState();
  const [levels, setLevels] = useState({ mic: 0, system: 0 });
  const [result, setResult] = useState<AudioCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => window.copilot.onLevels(setLevels), []);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await window.copilot.setup<AudioCheck>({ op: "audioCheck" }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const heard = (c: { state: string; peak: number }) => c.state === "live" && c.peak > 0.01;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">Say something, and play a video so the second bar moves. Takes 5 seconds; nothing is saved.</p>
      <Meter label="Your microphone" value={busy ? levels.mic : result?.mic.peak ?? 0} state={busy ? state?.audio.mic.state ?? "" : result?.mic.state ?? "not tested"} />
      <Meter label="Meeting audio" value={busy ? levels.system : result?.system.peak ?? 0} state={busy ? state?.audio.system.state ?? "" : result?.system.state ?? "not tested"} />
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void run()}>
        {busy ? "Listening…" : result ? "Test again" : "Test audio"}
      </button>
      {result && (
        <ul className="space-y-1 text-sm" data-testid="audio-result">
          <li>{heard(result.mic) ? "✓ Your microphone works." : `✗ No sound from your microphone${result.mic.message ? `: ${result.mic.message}` : ""}. Check the device in Settings and the OS microphone permission.`}</li>
          <li>
            {heard(result.system) ? "✓ Meeting audio works." : `✗ No meeting audio${result.system.message ? `: ${result.system.message}` : ""}. `}
            {!heard(result.system) && <Link to="/help/system-audio" className="underline">How to fix it</Link>}
          </li>
        </ul>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function SignInStep({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const [url, setUrl] = useState(settings.backendUrl);
  return (
    <div className="space-y-4">
      <AccountSettings settings={settings} update={update} compact />
      <ServerFields settings={settings} update={update} title="Using a different server?">
        <label className="mt-2 block">
          Backend URL
          <input className={`${inputClass} mt-1`} value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => void update({ backendUrl: url.trim() })} />
        </label>
      </ServerFields>
    </div>
  );
}

function KeysStep() {
  const signedIn = useAppState()?.auth.signedIn;
  const [rows, setRows] = useState<ProviderKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void window.copilot.setup<ProviderKey[]>({ op: "providers" }).then(setRows, (e) => setError(errorText(e)));
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn]);
  if (!signedIn) return <p className="text-sm">Sign in first (previous step); the keys are checked by your backend.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Your server needs three free keys (no card): Groq, Mistral and Deepgram. Paste each one; it's tested and saved on the server, never in this app.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="space-y-3" aria-label="AI providers">
        {rows?.filter((r) => r.required).map((r) => <KeyRow key={r.provider} row={r} onSaved={load} />)}
      </ul>
    </div>
  );
}

function KeyRow({ row, onSaved }: { row: ProviderKey; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const r = await window.copilot.setup<{ ok: boolean; detail: string; saved: boolean; env_line: string | null }>({ op: "saveKey", provider: row.provider, key });
      setNote({
        ok: r.ok,
        text: !r.ok ? `That key didn't work: ${r.detail}` : r.saved ? "Works, and saved on your backend." : `Works. Add ${r.env_line} to your backend's environment (it isn't running on this computer).`,
      });
      if (r.saved) {
        setKey("");
        onSaved();
      }
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800" data-testid={`key-${row.provider}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {row.provider}
          {row.required ? "" : <span className="ml-2 text-xs font-normal text-gray-500">optional fallback</span>}
        </span>
        <span className={row.has_key ? "text-green-700 dark:text-green-400" : "text-gray-500"}>{row.has_key ? "✓ Key set" : "No key yet"}</span>
      </div>
      <p className="text-xs text-gray-500">
        {row.trains_on_data === false ? "Doesn't train on your data. " : "Test data only (may train on what it gets). "}
        Used for {row.tasks.join(", ")}.
        {row.signup_url && (
          <>
            {" "}
            <a className="underline" href={row.signup_url} target="_blank" rel="noreferrer">Get a free key</a>
          </>
        )}
      </p>
      <div className="mt-2 flex gap-2">
        <input type="password" className={inputClass} aria-label={`${row.provider} API key`} placeholder={row.key_env} value={key} onChange={(e) => setKey(e.target.value)} />
        <button type="button" className={secondaryButtonClass} disabled={busy || key.trim().length < 8} onClick={() => void test()}>
          {busy ? "Testing…" : "Test and save"}
        </button>
      </div>
      {note && <p className={`mt-1 text-xs ${note.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`} role="status">{note.text}</p>}
    </li>
  );
}

function RoleStep() {
  const signedIn = useAppState()?.auth.signedIn;
  const [presets, setPresets] = useState<Record<string, RoleProfile>>({});
  const [profile, setProfile] = useState<RoleProfile | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    void window.copilot.profile.presets().then(setPresets);
    void window.copilot.profile.get().then(setProfile);
  }, [signedIn]);
  if (!signedIn || !profile) return <p className="text-sm">Sign in first; your role is kept on your backend.</p>;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-500 dark:text-gray-400">So the app knows which questions are for you.</p>
      <label className="block">
        Your name (as people say it)
        <input className={`${inputClass} mt-1`} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
      </label>
      <label className="block">
        Role
        <select
          className={`${inputClass} mt-1`}
          aria-label="Role preset"
          value=""
          onChange={(e) => presets[e.target.value] && setProfile({ ...presets[e.target.value], name: profile.name, aliases: profile.aliases })}
        >
          <option value="">{profile.title || "Pick a role"}</option>
          {Object.entries(presets).filter(([k]) => k !== "custom").map(([k, p]) => (
            <option key={k} value={k}>{p.title}</option>
          ))}
        </select>
      </label>
      <button type="button" className={secondaryButtonClass} onClick={() => void window.copilot.profile.put(profile).then(() => setSaved(true))}>
        {saved ? "Saved" : "Save"}
      </button>
      <p>
        Optional: <Link to="/voice" className="underline">enroll your voice</Link> so you're named in transcripts (only with your consent).
      </p>
    </div>
  );
}
